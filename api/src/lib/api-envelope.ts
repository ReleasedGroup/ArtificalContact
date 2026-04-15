export interface ApiError {
  code: string
  message: string
  field?: string
}

export interface ApiEnvelope<TData> {
  data: TData
  errors: ApiError[]
}
