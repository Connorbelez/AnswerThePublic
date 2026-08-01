const STANDARD_RESPONSE_QUESTION_PREFIX = "standard-prompt:"

/**
 * Stable scope identifier for the single response prompt owned by a Standard
 * Content Request. The server projects this identifier to clients; clients do
 * not invent or derive evidence authorization scopes themselves.
 */
export function standardResponseQuestionId(requestId: string) {
  return `${STANDARD_RESPONSE_QUESTION_PREFIX}${requestId}`
}
