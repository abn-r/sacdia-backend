import { Request, Response, NextFunction } from 'express';

const DEFAULT_TIMEOUT_MS = 30_000;

export function timeoutMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const timeoutMs = parseInt(
    process.env.REQUEST_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS),
    10,
  );

  const timer = setTimeout(() => {
    if (res.headersSent) return;

    res.status(408).json({
      statusCode: 408,
      message: 'Request timeout',
      error: 'Request Timeout',
    });
  }, timeoutMs);

  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));

  next();
}
