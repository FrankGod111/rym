export const deploymentConfig = {
  // Browser-side API base. Keep empty when using the Vite/Nginx reverse proxy (/api).
  // For direct server access, set to something like 'http://192.168.1.10:8013'.
  apiBaseUrl: '',

  // Optional defaults shown in the new Settings page. These do not affect runtime.
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen3:8b',
  difyBaseUrl: 'http://localhost/v1',
  embeddingProvider: 'dashscope',
  embeddingModel: 'text-embedding-v3',
  frontendPort: 5175,
};

export function apiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${deploymentConfig.apiBaseUrl}${normalizedPath}`;
}
