import { Schema, model } from "mongoose";

/**
 * Counter — atomic monotonically-increasing sequences.
 *
 * Used by the HD wallet to allocate the next derivation index for crypto
 * deposit addresses. Atomic findOneAndUpdate({_id}, {$inc: {seq: 1}}) makes
 * concurrent createOrder calls safe — each gets a unique index.
 *
 * Pre-seeded entries:
 *   _id="crypto_deriv_index", seq=0
 *     → next() returns 1, 2, 3, ... (index 0 reserved for hot wallet)
 */
export interface CounterDoc {
  _id: string;
  seq: number;
}

const CounterSchema = new Schema<CounterDoc>(
  {
    _id: { type: String },
    seq: { type: Number, default: 0 },
  },
  { _id: false },
);

export const CounterModel = model<CounterDoc>("Counter", CounterSchema);

/** Atomically allocate the next sequence number for a counter. */
export const nextSeq = async (id: string): Promise<number> => {
  const doc = await CounterModel.findOneAndUpdate(
    { _id: id },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return doc.seq;
};
