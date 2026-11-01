export interface CollectDto {
  events: unknown[]; // each validated by parseClientEvent; invalid ones dropped
}
