export function normalizeCpf(value: string) {
  return (value || "").replace(/\D+/g, "").slice(0, 11);
}

export function formatCpf(value: string) {
  const digits = normalizeCpf(value);
  const parts = [
    digits.slice(0, 3),
    digits.slice(3, 6),
    digits.slice(6, 9),
    digits.slice(9, 11),
  ].filter((part) => part.length > 0);

  if (parts.length <= 1) {
    return parts[0] ?? "";
  }
  if (parts.length === 2) {
    return `${parts[0]}.${parts[1]}`;
  }
  if (parts.length === 3) {
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }
  return `${parts[0]}.${parts[1]}.${parts[2]}-${parts[3]}`;
}

export function isValidCpf(value: string) {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11) {
    return false;
  }
  if (/^(\d)\1{10}$/.test(cpf)) {
    return false;
  }

  const firstDigit = calculateDigit(cpf.slice(0, 9), 10);
  const secondDigit = calculateDigit(cpf.slice(0, 10), 11);
  return cpf.endsWith(`${firstDigit}${secondDigit}`);
}

function calculateDigit(base: string, startFactor: number) {
  const sum = base
    .split("")
    .reduce((total, char, index) => total + Number(char) * (startFactor - index), 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}
