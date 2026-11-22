import { useEffect, useState } from 'react';
import {
  Bluetooth,
  BluetoothConnected,
  Headphones,
  LoaderCircle,
  Power,
  RefreshCw,
  Speaker,
  Trash2,
  Unlink,
} from 'lucide-react';
import type { BluetoothControl, BluetoothSnapshot } from '../api/bluetooth-types';
import { useTranslation } from '../i18n';

interface BluetoothDevicesPanelProps {
  snapshot: BluetoothSnapshot;
  loading: boolean;
  onControl: (control: BluetoothControl) => Promise<{ ok: boolean; error?: string }>;
}

export function BluetoothDevicesPanel({
  snapshot,
  loading,
  onControl,
}: BluetoothDevicesPanelProps) {
  const { t } = useTranslation();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pairingValue, setPairingValue] = useState('');

  useEffect(() => setPairingValue(''), [snapshot.challenge?.id]);

  const run = async (key: string, control: BluetoothControl) => {
    setBusyKey(key);
    setActionError(null);
    try {
      const result = await onControl(control);
      if (!result.ok) setActionError(result.error || t('music.bluetoothActionFailed'));
    } catch {
      setActionError(t('music.bluetoothActionFailed'));
    } finally {
      setBusyKey(null);
    }
  };

  const status = loading
    ? t('app.connecting')
    : !snapshot.configured
      ? t('music.bluetoothNotConfigured')
      : snapshot.connection === 'connecting'
        ? t('app.connecting')
        : snapshot.connection === 'connected'
          ? snapshot.adapter
            ? t('music.bluetoothConnected')
            : t('music.bluetoothNoAdapter')
          : t('music.bluetoothDisconnected');

  const statusClass =
    !snapshot.configured || snapshot.connection === 'disconnected' || !snapshot.adapter
      ? 'disconnected'
      : snapshot.connection === 'connecting'
        ? 'connecting'
        : 'ready';

  const submitPairingResponse = (event: { preventDefault(): void }, accept: boolean) => {
    event.preventDefault();
    if (!snapshot.challenge) return;
    void run('pairing-response', {
      action: 'pairing-response',
      challengeId: snapshot.challenge.id,
      accept,
      ...(accept && ['pin', 'passkey'].includes(snapshot.challenge.kind)
        ? { value: pairingValue }
        : {}),
    });
  };

  const isReady = snapshot.connection === 'connected' && Boolean(snapshot.adapter);
  const scan = () => void run('scan', { action: snapshot.scanning ? 'stop-scan' : 'scan' });

  return (
    <section className="bluetooth-panel" aria-labelledby="bluetooth-title">
      <header className="bluetooth-panel-header">
        <div className="bluetooth-panel-title">
          <span className="bluetooth-panel-icon">
            <Bluetooth size={19} />
          </span>
          <div>
            <h3 id="bluetooth-title">{t('music.bluetoothTitle')}</h3>
            <p>
              {snapshot.adapter?.name || t('music.bluetoothDescription')}
              {snapshot.adapter && !snapshot.adapter.powered
                ? ` · ${t('music.bluetoothPoweredOff')}`
                : ''}
            </p>
          </div>
        </div>
        <div className={'bluetooth-status bluetooth-status--' + statusClass} role="status">
          <span className="spotify-status-dot" />
          {status}
        </div>
      </header>

      {!snapshot.configured && !loading && (
        <div className="bluetooth-setup-help">
          <p>{t('music.bluetoothSetupRequired')}</p>
          <code>ABBAI_FLOW_BLUETOOTH_DBUS_ADDRESS=unix:path=/run/dbus/system_bus_socket</code>
          <p>{t('music.bluetoothSetupMount')}</p>
        </div>
      )}

      {snapshot.connection === 'disconnected' && snapshot.configured && (
        <p className="bluetooth-message" role="status">
          {snapshot.error || t('music.bluetoothDisconnectedHelp')}
        </p>
      )}

      {snapshot.connection === 'connected' && !snapshot.adapter && (
        <p className="bluetooth-message" role="status">
          {snapshot.error || t('music.bluetoothNoAdapterHelp')}
        </p>
      )}

      {isReady && (
        <div className="bluetooth-toolbar">
          <button
            type="button"
            className="bluetooth-action-button bluetooth-scan-button"
            onClick={scan}
            disabled={!snapshot.adapter?.powered || busyKey === 'scan'}
          >
            {busyKey === 'scan' ? (
              <LoaderCircle size={17} className="bluetooth-spinner" />
            ) : (
              <RefreshCw size={17} />
            )}
            {snapshot.scanning ? t('music.bluetoothStopScan') : t('music.bluetoothScan')}
          </button>
          <button
            type="button"
            className="bluetooth-power-button"
            aria-pressed={snapshot.adapter?.powered || false}
            onClick={() =>
              void run('power', { action: 'power', enabled: !snapshot.adapter?.powered })
            }
            disabled={busyKey === 'power'}
          >
            <Power size={17} />
            {snapshot.adapter?.powered ? t('music.bluetoothTurnOff') : t('music.bluetoothTurnOn')}
          </button>
        </div>
      )}

      {snapshot.notice && <p className="bluetooth-message">{snapshot.notice}</p>}

      {snapshot.challenge && (
        <form
          className="bluetooth-pairing-prompt"
          onSubmit={(event) => submitPairingResponse(event, true)}
        >
          <div>
            <strong>
              {t('music.bluetoothPairingWith', { device: snapshot.challenge.deviceName })}
            </strong>
            <p>
              {snapshot.challenge.kind === 'confirm'
                ? t('music.bluetoothConfirmCode', {
                    code: snapshot.challenge.displayedValue || '',
                  })
                : snapshot.challenge.kind === 'pin'
                  ? t('music.bluetoothEnterPin')
                  : snapshot.challenge.kind === 'passkey'
                    ? t('music.bluetoothEnterPasskey')
                    : snapshot.challenge.kind === 'service'
                      ? t('music.bluetoothAuthorizeService', {
                          service: snapshot.challenge.service || '',
                        })
                      : t('music.bluetoothAuthorizeDevice')}
            </p>
          </div>
          {['pin', 'passkey'].includes(snapshot.challenge.kind) && (
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={snapshot.challenge.kind === 'passkey' ? 6 : 16}
              value={pairingValue}
              onChange={(event) => setPairingValue(event.target.value)}
              aria-label={t('music.bluetoothPairingCode')}
              placeholder={t('music.bluetoothPairingCode')}
              required
            />
          )}
          <div className="bluetooth-prompt-actions">
            <button
              type="button"
              className="bluetooth-action-button is-secondary"
              disabled={busyKey === 'pairing-response'}
              onClick={(event) => submitPairingResponse(event, false)}
            >
              {t('music.bluetoothDecline')}
            </button>
            <button
              type="submit"
              className="bluetooth-action-button"
              disabled={
                busyKey === 'pairing-response' ||
                (['pin', 'passkey'].includes(snapshot.challenge.kind) && !pairingValue)
              }
            >
              {snapshot.challenge.kind === 'pin' || snapshot.challenge.kind === 'passkey'
                ? t('music.bluetoothSubmitCode')
                : t('music.bluetoothConfirm')}
            </button>
          </div>
        </form>
      )}

      {actionError && (
        <p className="bluetooth-message is-error" role="alert">
          {actionError}
        </p>
      )}

      {isReady && (
        <div className="bluetooth-device-list">
          {snapshot.devices.length === 0 ? (
            <p className="bluetooth-empty-state">
              {snapshot.scanning ? t('music.bluetoothScanning') : t('music.bluetoothNoDevices')}
            </p>
          ) : (
            snapshot.devices.map((device) => {
              const DeviceIcon = device.icon?.includes('head') ? Headphones : Speaker;
              return (
                <article className="bluetooth-device" key={device.address}>
                  <span className="bluetooth-device-icon">
                    {device.connected ? <BluetoothConnected size={19} /> : <DeviceIcon size={19} />}
                  </span>
                  <div className="bluetooth-device-copy">
                    <strong>{device.name}</strong>
                    <span>
                      {device.connected
                        ? t('music.bluetoothDeviceConnected')
                        : device.paired
                          ? t('music.bluetoothDevicePaired')
                          : t('music.bluetoothDeviceAvailable')}
                      {device.rssi !== null ? ` · ${device.rssi} dBm` : ''}
                    </span>
                  </div>
                  <div className="bluetooth-device-actions">
                    {device.connected ? (
                      <button
                        type="button"
                        className="bluetooth-action-button is-secondary"
                        aria-label={t('music.bluetoothDisconnectDevice', { device: device.name })}
                        disabled={busyKey === device.address}
                        onClick={() =>
                          void run(device.address, {
                            action: 'disconnect',
                            address: device.address,
                          })
                        }
                      >
                        {busyKey === device.address ? (
                          <LoaderCircle size={16} className="bluetooth-spinner" />
                        ) : (
                          <Unlink size={16} />
                        )}
                        {t('music.bluetoothDisconnect')}
                      </button>
                    ) : device.paired ? (
                      <button
                        type="button"
                        className="bluetooth-action-button"
                        disabled={busyKey === device.address || !snapshot.adapter?.powered}
                        onClick={() =>
                          void run(device.address, { action: 'connect', address: device.address })
                        }
                      >
                        {busyKey === device.address ? (
                          <LoaderCircle size={16} className="bluetooth-spinner" />
                        ) : (
                          <BluetoothConnected size={16} />
                        )}
                        {t('music.bluetoothConnect')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="bluetooth-action-button"
                        disabled={busyKey === device.address || !snapshot.adapter?.powered}
                        onClick={() =>
                          void run(device.address, { action: 'pair', address: device.address })
                        }
                      >
                        {busyKey === device.address ? (
                          <LoaderCircle size={16} className="bluetooth-spinner" />
                        ) : (
                          <Bluetooth size={16} />
                        )}
                        {t('music.bluetoothPair')}
                      </button>
                    )}
                    {device.paired && (
                      <button
                        type="button"
                        className="bluetooth-forget-button"
                        aria-label={t('music.bluetoothForgetDevice', { device: device.name })}
                        disabled={busyKey === device.address}
                        onClick={() =>
                          void run(device.address, { action: 'forget', address: device.address })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>
      )}

      {snapshot.adapter && (
        <p className="bluetooth-footnote">{t('music.bluetoothAudioRoutingNote')}</p>
      )}
    </section>
  );
}
