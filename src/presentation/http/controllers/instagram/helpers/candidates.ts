export function candidatesOrderBy() {
  return [
    { selectedAt: "desc" as const },
    { createdAt: "desc" as const },
  ];
}
