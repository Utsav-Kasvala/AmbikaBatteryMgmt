import { z } from 'zod';

/** A non-negative decimal as string, max 4 fractional digits, max 14 integer digits. */
export const decimalAmount = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v), {
    message: 'Must be a non-negative decimal with at most 4 fractional digits',
  })
  .refine((v) => v.split('.')[0].length <= 14, {
    message: 'Value too large (max 14 digits before decimal)',
  });

/** Strictly-positive decimal (opening stock can't be zero or negative). */
export const positiveDecimal = decimalAmount.refine(
  (v) => parseFloat(v) > 0,
  { message: 'Must be greater than zero' },
);

/** Signed decimal, non-zero. Used for adjustments. */
export const signedDecimal = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^-?\d+(\.\d{1,4})?$/.test(v), {
    message: 'Must be a signed decimal with at most 4 fractional digits',
  })
  .refine((v) => v.replace('-', '').split('.')[0].length <= 14, {
    message: 'Value too large (max 14 digits)',
  })
  .refine((v) => parseFloat(v) !== 0, { message: 'Cannot be zero' });

export const materialUnit = z.enum(['KG', 'G', 'LITRES', 'ML', 'PIECES']);

/** A non-negative integer, max 2^31 - 1 (Postgres `integer`). */
export const wholeNumber = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const s = String(v);
    if (!/^\d+$/.test(s)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be a non-negative integer' });
      return z.NEVER;
    }
    const n = Number(s);
    if (!Number.isSafeInteger(n) || n > 2147483647) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Value out of range for integer' });
      return z.NEVER;
    }
    return n;
  });

/** Strictly-positive integer (opening stock for batteries). */
export const positiveWholeNumber = wholeNumber.refine((n) => n > 0, {
  message: 'Must be greater than zero',
});

/** Signed non-zero integer. Used for battery-type adjustments. */
export const signedWholeNumber = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const s = String(v);
    if (!/^-?\d+$/.test(s)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be a signed integer' });
      return z.NEVER;
    }
    const n = Number(s);
    if (!Number.isSafeInteger(n) || Math.abs(n) > 2147483647) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Value out of range' });
      return z.NEVER;
    }
    if (n === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Cannot be zero' });
      return z.NEVER;
    }
    return n;
  });
