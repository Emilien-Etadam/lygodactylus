import { writeMCPLog } from '../mcp-logger.js';
import { isLoopbackBaseUrl } from '../../../shared/network/loopback.js';
import { OLLAMA_PLACEHOLDER_KEY } from '../../config/auth-utils.js';

const DEFAULT_OPENAI_BASE_URL = 'http://localhost:11434/v1';

export async function callVisionAPI(
  base64Image: string,
  prompt: string,
  maxTokens: number = 2048
): Promise<string> {
  const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
  const baseUrl = process.env.OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL;
  const model = process.env.OPENAI_MODEL?.trim() || 'llama3.2';
  const apiKey = openAIApiKey || (isLoopbackBaseUrl(baseUrl) ? OLLAMA_PLACEHOLDER_KEY : '');

  if (!apiKey) {
    throw new Error('API key not configured. Please configure OPENAI_API_KEY in Settings.');
  }

  writeMCPLog(prompt, 'PROMPT');

  const openAIUrl = baseUrl.endsWith('/v1')
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const https = require('https');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const http = require('http');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const url = require('url');

  const urlObj = new url.URL(openAIUrl);
  const isHttps = urlObj.protocol === 'https:';
  const httpModule = isHttps ? https : http;

  const requestBodyObj: Record<string, unknown> = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${base64Image}`,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
    max_tokens: maxTokens,
  };

  const requestBody = JSON.stringify(requestBodyObj);

  const headers: Record<string, string | number> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'Content-Length': Buffer.byteLength(requestBody),
  };

  return new Promise<string>((resolve, reject) => {
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = httpModule.request(options, (res: any) => {
      let data = '';

      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });

      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const jsonData = JSON.parse(data);
            const responseContent = jsonData.choices[0]?.message?.content || '';
            writeMCPLog(JSON.stringify(jsonData), 'RESPONSE');
            resolve(responseContent);
          } catch (e: unknown) {
            reject(
              new Error(
                `Failed to parse API response: ${e instanceof Error ? e.message : String(e)}`
              )
            );
          }
        } else {
          reject(new Error(`API request failed: ${res.statusCode} ${res.statusMessage} - ${data}`));
        }
      });
    });

    req.on('error', (error: Error) => {
      reject(new Error(`API request error: ${error.message}`));
    });

    req.write(requestBody);
    req.end();
  });
}
