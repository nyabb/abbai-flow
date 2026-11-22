/**
 * Shared Bluetooth runtime entry point for the standalone server image.
 *
 * The Docker runtime intentionally ships only the built app, `ws`, and the
 * compiled server modules. Bundle this module so the HTTP handler and manager
 * share one copy of their types and dbus-next is included in that bundle.
 */
export {
  BluetoothManager,
  BluetoothOperationError,
  validateBluetoothControl,
} from './bluetooth-manager';
export { handleBluetoothRequest } from './bluetooth-http';
