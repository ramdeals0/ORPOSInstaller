export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
    public details?: unknown,
  ) {
    super(message)
  }
}

export function errorBody(err: AppError) {
  return {
    error: {
      code: err.code,
      message: err.message,
      details: err.details ?? [],
    },
  }
}
