import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AuthController } from './controllers/auth.controller';
import { openApiDocument } from './docs/openapi';
import { HttpError } from './errors/HttpError';
import { AuthService } from './services/auth.service';

type HttpMethod = 'GET' | 'POST' | 'OPTIONS';

type RouteHandler = (context: RequestContext) => Promise<RouteResponse>;

interface RouteDefinition {
  method: HttpMethod;
  path: string;
  handler: RouteHandler;
}

interface RequestContext {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

interface RouteResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export class Application {
  private readonly routes: RouteDefinition[] = [];
  private readonly authController: AuthController;

  constructor() {
    this.authController = new AuthController(new AuthService());
    this.registerRoutes();
  }

  listen(port: number, callback?: () => void): void {
    const server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    server.listen(port, callback);
  }

  private registerRoutes(): void {
    this.routes.push(
      {
        method: 'POST',
        path: '/api/login',
        handler: async (context) => {
          const result = await this.authController.login(context.body);
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: result
          };
        }
      },
      {
        method: 'GET',
        path: '/docs/openapi.json',
        handler: async () => ({
          statusCode: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: openApiDocument
        })
      },
      {
        method: 'GET',
        path: '/docs',
        handler: async () => ({
          statusCode: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          body: renderDocumentationPage()
        })
      }
    );
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase() as HttpMethod;
    const url = req.url ?? '/';

    if (method === 'OPTIONS') {
      this.sendResponse(res, {
        statusCode: 204,
        headers: this.defaultHeaders()
      });
      return;
    }

    const { pathname, searchParams } = new URL(url, `http://${req.headers?.host ?? 'localhost'}`);
    const route = this.routes.find((definition) => definition.method === method && definition.path === pathname);

    if (!route) {
      this.sendResponse(res, {
        statusCode: 404,
        headers: this.defaultHeaders(),
        body: { message: 'Resource not found.' }
      });
      return;
    }

    try {
      const body = await this.parseBody(req);
      const context: RequestContext = {
        method,
        path: pathname,
        query: Object.fromEntries(searchParams.entries()),
        headers: this.normalizeHeaders(req.headers ?? {}),
        body
      };

      const result = await route.handler(context);
      this.sendResponse(res, result);
    } catch (error) {
      const httpError = this.mapError(error);
      this.sendResponse(res, {
        statusCode: httpError.statusCode,
        headers: this.defaultHeaders(),
        body: {
          message: httpError.message,
          details: httpError.details
        }
      });
    }
  }

  private async parseBody(req: IncomingMessage): Promise<unknown> {
    const method = (req.method ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD') {
      return undefined;
    }

    const contentType = String(req.headers?.['content-type'] ?? '');

    return await new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', (chunk: any) => {
        raw += chunk.toString();
      });

      req.on('end', () => {
        if (!raw) {
          resolve(undefined);
          return;
        }

        if (contentType.includes('application/json')) {
          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(new HttpError(400, 'Request body must be valid JSON.'));
          }
          return;
        }

        resolve(raw);
      });

      req.on('error', (error: Error) => {
        reject(new HttpError(400, `Failed to read request body: ${error.message}`));
      });
    });
  }

  private normalizeHeaders(headers: Record<string, unknown>): Record<string, string> {
    const normalized: Record<string, string> = {};
    Object.keys(headers).forEach((key) => {
      const value = headers[key];
      if (typeof value === 'string') {
        normalized[key.toLowerCase()] = value;
      }
    });
    return normalized;
  }

  private sendResponse(res: ServerResponse, response: RouteResponse): void {
    const headers = {
      ...this.defaultHeaders(),
      ...(response.headers ?? {})
    };

    res.statusCode = response.statusCode;
    Object.keys(headers).forEach((key) => {
      res.setHeader(key, headers[key]);
    });

    if (response.body === undefined) {
      res.end();
      return;
    }

    if (typeof response.body === 'string') {
      res.end(response.body);
      return;
    }

    res.end(JSON.stringify(response.body));
  }

  private defaultHeaders(): Record<string, string> {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json; charset=utf-8'
    };
  }

  private mapError(error: unknown): HttpError {
    if (error instanceof HttpError) {
      return error;
    }

    const generic = new HttpError(500, 'An unexpected error occurred.');
    if (error instanceof Error) {
      generic.details = { reason: error.message };
    }
    return generic;
  }
}

function renderDocumentationPage(): string {
  const prettySpec = JSON.stringify(openApiDocument, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Banking Authentication API</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 2rem; background: #f7f9fc; color: #1f2933; }
    pre { background: #0b172a; color: #e8f1ff; padding: 1rem; border-radius: 8px; overflow-x: auto; }
    a { color: #2563eb; }
  </style>
</head>
<body>
  <h1>Banking Authentication API</h1>
  <p>
    Download the <a href="/docs/openapi.json" target="_blank" rel="noopener noreferrer">OpenAPI document</a>
    or copy the JSON specification below.
  </p>
  <pre><code>${prettySpec}</code></pre>
</body>
</html>`;
}
