// Formatting/id helpers ported verbatim from the HTML prototype.

export const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

export const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

export const fmtKg = (n: number) => `${Math.round(n).toLocaleString("en-KE")} kg`;

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const nowKE = () => new Date().toLocaleString("en-KE", { hour12: false });

export const daysAgoKE = (daysAgo: number) =>
	new Date(Date.now() - daysAgo * 86400000).toLocaleString("en-KE", { hour12: false });
