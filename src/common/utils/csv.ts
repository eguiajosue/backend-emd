/**
 * Writer CSV minimalista: escapa comillas dobles y envuelve entre comillas
 * cualquier celda que contenga coma, comilla o salto de línea (RFC 4180).
 * No requiere una librería pesada de Excel — el .csv resultante se abre
 * en Excel sin problemas.
 */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let str = String(value);
  // Previene CSV/formula injection: si la celda empieza con un carácter que
  // Excel/Sheets interpreta como inicio de fórmula (=, +, -, @, tab, CR), se
  // le antepone un apóstrofe para forzar que se trate como texto literal.
  // Sin esto, un valor controlado por el usuario (ej. nombre de cliente o
  // descripción de pedido) podría ejecutar una fórmula al abrir el export.
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(','));
  }
  // BOM UTF-8 para que Excel reconozca tildes/ñ correctamente.
  return '﻿' + lines.join('\r\n') + '\r\n';
}
