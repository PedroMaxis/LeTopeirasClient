import type { MediaAccessPermissionRequest, Session } from 'electron';
import { isTrustedUrl } from './renderer';

// Microphone, screen capture (via our own picker), fullscreen video, output device selection
// copying invite codes and message notifications.
const allowedPermissions = new Set<string>([
  'media',
  'display-capture',
  'fullscreen',
  'speaker-selection',
  'clipboard-sanitized-write',
  'notifications',
]);

export function configurePermissions(ses: Session): void {
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (!allowedPermissions.has(permission) || !isTrustedUrl(details.requestingUrl)) {
      return callback(false);
    }
    if (permission === 'media') {
      // Only the microphone; there is no camera support.
      const { mediaTypes = [] } = details as MediaAccessPermissionRequest;
      return callback(mediaTypes.every((type) => type === 'audio'));
    }
    callback(true);
  });

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    return (
      allowedPermissions.has(permission) && isTrustedUrl(details.requestingUrl ?? requestingOrigin)
    );
  });
}
