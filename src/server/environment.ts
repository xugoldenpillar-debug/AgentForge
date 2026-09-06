/** Test models require an explicit environment, never NODE_ENV or an old Demo flag alone. */
export function testModelsEnabled(env: Record<string, string | undefined>): boolean {
  return env.APP_ENV === 'test' && env.DEMO_MODE === 'true';
}
