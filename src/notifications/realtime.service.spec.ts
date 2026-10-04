import { EventEmitter } from 'node:events';
import { REALTIME_DEBOUNCE_MS, RealtimeService } from './realtime.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

describe('RealtimeService', () => {
  let changes: EventEmitter;
  let gateway: { notifyDataChanged: jest.Mock };
  let service: RealtimeService;

  beforeEach(() => {
    jest.useFakeTimers();
    changes = new EventEmitter();
    gateway = { notifyDataChanged: jest.fn() };
    service = new RealtimeService(
      { changes } as unknown as PrismaService,
      gateway as unknown as NotificationsGateway,
    );
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('agrupa las escrituras de un mismo cambio en un solo aviso', () => {
    changes.emit('change', { model: 'Order', action: 'create' });
    changes.emit('change', { model: 'OrderAreaTask', action: 'createMany' });
    changes.emit('change', { model: 'Order', action: 'update' });
    expect(gateway.notifyDataChanged).not.toHaveBeenCalled();
    jest.advanceTimersByTime(REALTIME_DEBOUNCE_MS);
    expect(gateway.notifyDataChanged).toHaveBeenCalledTimes(1);
    expect(gateway.notifyDataChanged).toHaveBeenCalledWith([
      'Order',
      'OrderAreaTask',
    ]);
  });

  it('no avisa por modelos que no muestran los Inicio (chat, sesiones...)', () => {
    changes.emit('change', { model: 'ChatMessage', action: 'create' });
    changes.emit('change', { model: 'User', action: 'update' });
    jest.advanceTimersByTime(REALTIME_DEBOUNCE_MS);
    expect(gateway.notifyDataChanged).not.toHaveBeenCalled();
  });

  it('después de avisar vuelve a juntar desde cero', () => {
    changes.emit('change', { model: 'InventoryItem', action: 'update' });
    jest.advanceTimersByTime(REALTIME_DEBOUNCE_MS);
    changes.emit('change', { model: 'CalendarEvent', action: 'create' });
    jest.advanceTimersByTime(REALTIME_DEBOUNCE_MS);
    expect(gateway.notifyDataChanged.mock.calls).toEqual([
      [['InventoryItem']],
      [['CalendarEvent']],
    ]);
  });
});
