// Deployment-time addresses used by Vite dev/proxy configuration.
// For Windows/server deployment, change these values here first.
export const deploymentConfig = {
  frontendHost: '0.0.0.0',
  frontendPort: 5175,
  backendBaseUrl: 'http://127.0.0.1:8013',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen3:8b',
  // Local Dify via nginx (same as browser: http://localhost)
  difyBaseUrl: 'http://localhost/v1',
};
