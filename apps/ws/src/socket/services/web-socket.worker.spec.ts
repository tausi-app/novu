import { Test } from '@nestjs/testing';
import { expect } from 'chai';
import { setTimeout } from 'timers/promises';

import { WebSocketsQueueService } from '@novu/application-generic';

import { WebSocketWorker } from './web-socket.worker';

import { SocketModule } from '../socket.module';
import { ExternalServicesRoute } from '../usecases/external-services-route';

let webSocketsQueueService: WebSocketsQueueService;
let webSocketWorker: WebSocketWorker;

describe('WebSocket Worker', () => {
  before(async () => {
    process.env.IN_MEMORY_CLUSTER_MODE_ENABLED = 'false';
    process.env.IS_IN_MEMORY_CLUSTER_MODE_ENABLED = 'false';

    const moduleRef = await Test.createTestingModule({
      imports: [SocketModule],
    }).compile();

    const externalServicesRoute = moduleRef.get<ExternalServicesRoute>(ExternalServicesRoute);
    webSocketWorker = new WebSocketWorker(externalServicesRoute);

    webSocketsQueueService = new WebSocketsQueueService();
    await webSocketsQueueService.queue.obliterate();
  });

  after(async () => {
    await webSocketsQueueService.queue.drain();
    await webSocketWorker.gracefulShutdown();
  });

  it('should be initialised properly', async () => {
    expect(webSocketWorker).to.be.ok;
    expect(webSocketWorker).to.have.all.keys('DEFAULT_ATTEMPTS', 'instance', 'externalServicesRoute', 'topic');
    expect(await webSocketWorker.bullMqService.getStatus()).to.deep.equal({
      queueIsPaused: undefined,
      queueName: undefined,
      workerName: 'ws_socket_queue',
      workerIsPaused: false,
      workerIsRunning: true,
    });
    expect(webSocketWorker.worker.opts).to.deep.include({
      concurrency: 50,
      lockDuration: 90000,
    });
  });

  it('should be able to automatically pull a job from the queue', async () => {
    const existingJobs = await webSocketsQueueService.queue.getJobs();
    expect(existingJobs.length).to.equal(0);

    const jobId = 'web-socket-queue-job-id';
    const _environmentId = 'web-socket-queue-environment-id';
    const _organizationId = 'web-socket-queue-organization-id';
    const _userId = 'web-socket-queue-user-id';
    const jobData = {
      _id: jobId,
      test: 'web-socket-queue-job-data',
      _environmentId,
      _organizationId,
      _userId,
    };

    await webSocketsQueueService.add(jobId, jobData, _organizationId);

    expect(await webSocketsQueueService.queue.getActiveCount()).to.equal(1);
    expect(await webSocketsQueueService.queue.getWaitingCount()).to.equal(0);

    // When we arrive to pull the job it has been already pulled by the worker
    const nextJob = await webSocketWorker.worker.getNextJob(jobId);
    expect(nextJob).to.equal(undefined);

    await setTimeout(100);

    // No jobs left in queue
    const queueJobs = await webSocketsQueueService.queue.getJobs();
    expect(queueJobs.length).to.equal(0);
  });
});
