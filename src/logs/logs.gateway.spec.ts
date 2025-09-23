/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { LogsGateway } from './logs.gateway';
import { LogsService } from './logs.service';
import { LogBufferService } from './services/log-buffer/log-buffer.service';
import { JwtService } from '../auth/jwt.service';
import { Socket, Server } from 'socket.io';

describe('LogsGateway', () => {
  let gateway: LogsGateway;
  let logsService: jest.Mocked<LogsService>;
  let logBufferService: jest.Mocked<LogBufferService>;
  let jwtService: jest.Mocked<JwtService>;

  const mockSocket = {
    id: 'test-socket-id',
    data: {},
    handshake: {
      auth: {
        token: 'test-token',
      },
    },
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as Socket;

  const mockServer = {
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
  } as unknown as Server;

  beforeEach(async () => {
    const mockLogsService = {
      checkAccess: jest.fn(),
      getHistoricalLogs: jest.fn(),
    };

    const mockLogBufferService = {
      getRecentLogs: jest.fn(),
    };

    const mockJwtService = {
      decode: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LogsGateway,
        {
          provide: LogsService,
          useValue: mockLogsService,
        },
        {
          provide: LogBufferService,
          useValue: mockLogBufferService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    gateway = module.get<LogsGateway>(LogsGateway);
    logsService = module.get(LogsService);
    logBufferService = module.get(LogBufferService);
    jwtService = module.get(JwtService);

    gateway.server = mockServer;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleConnection', () => {
    it('should accept valid token and set userId', () => {
      const mockDecode = jwtService.decode as jest.MockedFunction<
        typeof jwtService.decode
      >;
      mockDecode.mockReturnValue({ userId: 'test-user-id' });

      gateway.handleConnection(mockSocket);

      expect(mockDecode).toHaveBeenCalledWith('test-token');
      expect(mockSocket.data.userId).toBe('test-user-id');
      expect(mockSocket.disconnect).not.toHaveBeenCalled();
    });

    it('should disconnect client with invalid token', () => {
      const mockDecode = jwtService.decode as jest.MockedFunction<
        typeof jwtService.decode
      >;
      mockDecode.mockReturnValue(null);

      gateway.handleConnection(mockSocket);

      expect(mockSocket.disconnect).toHaveBeenCalled();
    });
  });

  describe('handleSubscribe', () => {
    beforeEach(() => {
      mockSocket.data.userId = 'test-user-id';
    });

    it('should subscribe to execution with valid access', async () => {
      const payload = { executionId: 'test-execution-id' };
      const mockCheckAccess = logsService.checkAccess as jest.MockedFunction<
        typeof logsService.checkAccess
      >;
      const mockGetRecentLogs =
        logBufferService.getRecentLogs as jest.MockedFunction<
          typeof logBufferService.getRecentLogs
        >;
      const mockGetHistoricalLogs =
        logsService.getHistoricalLogs as jest.MockedFunction<
          typeof logsService.getHistoricalLogs
        >;

      mockCheckAccess.mockResolvedValue(true);
      mockGetRecentLogs.mockReturnValue([]);
      mockGetHistoricalLogs.mockResolvedValue([]);

      await gateway.handleSubscribe(mockSocket, payload);

      expect(mockCheckAccess).toHaveBeenCalledWith(
        'test-user-id',
        'test-execution-id',
      );
      expect(mockSocket.join).toHaveBeenCalledWith(
        'execution:test-execution-id',
      );
      expect(mockSocket.emit).toHaveBeenCalledWith('subscribed', {
        executionId: 'test-execution-id',
      });
    });

    it('should emit error for unauthorized access', async () => {
      const payload = { executionId: 'test-execution-id' };
      const mockCheckAccess = logsService.checkAccess as jest.MockedFunction<
        typeof logsService.checkAccess
      >;
      mockCheckAccess.mockResolvedValue(false);

      await gateway.handleSubscribe(mockSocket, payload);

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'Access denied to this execution',
        code: 'ACCESS_DENIED',
      });
      expect(mockSocket.join).not.toHaveBeenCalled();
    });

    it('should emit buffered and historical logs if available', async () => {
      const payload = { executionId: 'test-execution-id' };
      const bufferedLogs = [
        {
          executionId: 'test-execution-id',
          timestamp: new Date(),
          message: 'buffered log',
          level: 'info' as const,
        },
      ];
      const historicalLogs = [
        {
          id: 1,
          executionId: 'test-execution-id',
          timestamp: new Date(),
          message: 'historical log',
          level: 'info' as const,
          createdAt: new Date(),
          execution: {} as unknown,
        },
      ];

      const mockCheckAccess = logsService.checkAccess as jest.MockedFunction<
        typeof logsService.checkAccess
      >;
      const mockGetRecentLogs =
        logBufferService.getRecentLogs as jest.MockedFunction<
          typeof logBufferService.getRecentLogs
        >;
      const mockGetHistoricalLogs =
        logsService.getHistoricalLogs as jest.MockedFunction<
          typeof logsService.getHistoricalLogs
        >;

      mockCheckAccess.mockResolvedValue(true);
      mockGetRecentLogs.mockReturnValue(bufferedLogs);
      mockGetHistoricalLogs.mockResolvedValue(historicalLogs);

      await gateway.handleSubscribe(mockSocket, payload);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'logs:buffered',
        bufferedLogs,
      );
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'logs:historical',
        historicalLogs,
      );
    });
  });

  describe('handleUnsubscribe', () => {
    it('should leave execution room', async () => {
      const payload = { executionId: 'test-execution-id' };

      await gateway.handleUnsubscribe(mockSocket, payload);

      expect(mockSocket.leave).toHaveBeenCalledWith(
        'execution:test-execution-id',
      );
      expect(mockSocket.emit).toHaveBeenCalledWith('unsubscribed', {
        executionId: 'test-execution-id',
      });
    });
  });

  describe('handleNewLogs', () => {
    it('should broadcast logs to execution room', () => {
      const executionId = 'test-execution-id';
      const logs = [{ message: 'test log' }];

      gateway.handleNewLogs({ executionId, logs });

      expect(mockServer.to).toHaveBeenCalledWith('execution:test-execution-id');
      expect(mockServer.emit).toHaveBeenCalledWith('logs:new', logs[0]);
    });
  });

  describe('broadcastStatusChange', () => {
    it('should broadcast status change to execution room', () => {
      const executionId = 'test-execution-id';
      const status = 'SUCCESS';

      gateway.broadcastStatusChange(executionId, status);

      expect(mockServer.to).toHaveBeenCalledWith('execution:test-execution-id');
      expect(mockServer.emit).toHaveBeenCalledWith('status:changed', {
        executionId,
        status,
      });
    });
  });

  describe('broadcastExecutionComplete', () => {
    it('should broadcast execution complete to room', () => {
      const executionId = 'test-execution-id';
      const status = 'SUCCESS';

      gateway.broadcastExecutionComplete(executionId, status);

      expect(mockServer.to).toHaveBeenCalledWith('execution:test-execution-id');
      expect(mockServer.emit).toHaveBeenCalledWith('execution:complete', {
        executionId,
        status,
      });
    });
  });
});
