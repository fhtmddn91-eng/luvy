export function won(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

export function dateFmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}
