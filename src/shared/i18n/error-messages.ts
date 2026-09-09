import { ERROR_CODES, type ErrorCode } from '../errors.ts';
import type { MessageKey } from './types.ts';

/** Stable server error codes map to safe, locale-aware UI messages. */
export const ERROR_MESSAGE_KEYS: Record<ErrorCode, MessageKey> = {
  [ERROR_CODES.AUTH_REQUIRED]: 'errors.authentication',
  [ERROR_CODES.RATE_LIMITED]: 'errors.rateLimited',
  [ERROR_CODES.CHALLENGE_NOT_FOUND]: 'errors.challengeUnavailable',
  [ERROR_CODES.BUILD_NOT_FOUND]: 'errors.buildNotFound',
  [ERROR_CODES.VERSION_NOT_FOUND]: 'errors.versionNotFound',
  [ERROR_CODES.RESOURCE_NOT_FOUND]: 'errors.resourceNotFound',
  [ERROR_CODES.OWNERSHIP_FORBIDDEN]: 'errors.ownershipForbidden',
  [ERROR_CODES.ACCESS_FORBIDDEN]: 'errors.accessForbidden',
  [ERROR_CODES.BUILD_VERSION_CONFLICT]: 'errors.saveConflict',
  [ERROR_CODES.CONCURRENT_SAVE]: 'errors.saveConflict',
  [ERROR_CODES.FAILURE_ALREADY_SUBMITTED]: 'errors.failureAlreadySubmitted',
  [ERROR_CODES.REQUEST_CONTENT_TYPE_INVALID]: 'errors.requestContentType',
  [ERROR_CODES.REQUEST_BODY_REQUIRED]: 'errors.requestBodyRequired',
  [ERROR_CODES.REQUEST_BODY_TOO_LARGE]: 'errors.requestBodyTooLarge',
  [ERROR_CODES.INVALID_JSON_BODY]: 'errors.invalidJsonBody',
  [ERROR_CODES.REQUEST_VALIDATION_FAILED]: 'errors.requestValidation',
  [ERROR_CODES.INVALID_WORKFLOW]: 'errors.workflowInvalid',
  [ERROR_CODES.PROVIDER_CONFIGURATION_INVALID]: 'errors.providerConfiguration',
  [ERROR_CODES.PROVIDER_NOT_CONFIGURED]: 'errors.providerNotConfigured',
  [ERROR_CODES.PROVIDER_NOT_FOUND]: 'errors.providerNotFound',
  [ERROR_CODES.PROVIDER_NETWORK_REJECTED]: 'errors.providerNetworkRejected',
  [ERROR_CODES.PROVIDER_AUTHENTICATION_FAILED]: 'errors.providerAuthenticationFailed',
  [ERROR_CODES.PROVIDER_REQUEST_INVALID]: 'errors.providerRequestInvalid',
  [ERROR_CODES.PROVIDER_REQUEST_FAILED]: 'errors.providerRequestFailed',
  [ERROR_CODES.PROVIDER_RESPONSE_INVALID]: 'errors.providerResponseInvalid',
  [ERROR_CODES.PROVIDER_CONSENT_REQUIRED]: 'errors.providerConsent',
  [ERROR_CODES.BUDGET_EXCEEDED]: 'errors.budgetExceeded',
  [ERROR_CODES.RUN_ALREADY_ACTIVE]: 'errors.runAlreadyActive',
  [ERROR_CODES.RUN_CANCELLED]: 'errors.runCancelled',
  [ERROR_CODES.RUNTIME_UNAVAILABLE]: 'errors.runtimeUnavailable',
  [ERROR_CODES.RUNTIME_POLICY_DENIED]: 'errors.runtimePolicyDenied',
  [ERROR_CODES.ENDPOINT_NOT_FOUND]: 'errors.endpointNotFound',
  [ERROR_CODES.COMPONENT_DEFINITION_INVALID]: 'errors.componentDefinitionInvalid',
  [ERROR_CODES.COMPONENT_UNSUPPORTED_CAPABILITY]: 'errors.componentUnsupportedCapability',
  [ERROR_CODES.COMPONENT_ATTACHMENT_INVALID]: 'errors.componentAttachmentInvalid',
  [ERROR_CODES.COMPONENT_LICENSE_REQUIRED]: 'errors.componentLicenseRequired',
  [ERROR_CODES.COMPONENT_LICENSE_UNSUPPORTED]: 'errors.componentLicenseUnsupported',
  [ERROR_CODES.COMPONENT_VERSION_CONFLICT]: 'errors.componentVersionConflict',
  [ERROR_CODES.SELF_TEST_NOT_ALLOWED]: 'errors.selfTestNotAllowed',
  [ERROR_CODES.SELF_TEST_QUOTA_EXCEEDED]: 'errors.selfTestQuotaExceeded',
  [ERROR_CODES.SELF_TEST_CONSENT_REQUIRED]: 'errors.selfTestConsentRequired',
  [ERROR_CODES.EVALUATION_NOT_READY]: 'errors.evaluationNotReady',
  [ERROR_CODES.UNKNOWN_ERROR]: 'errors.generic',
  [ERROR_CODES.INTERNAL_SERVER_ERROR]: 'errors.generic'
};

export function errorMessageKey(code: string | undefined): MessageKey | undefined {
  return code && Object.prototype.hasOwnProperty.call(ERROR_MESSAGE_KEYS, code)
    ? ERROR_MESSAGE_KEYS[code as ErrorCode]
    : undefined;
}
