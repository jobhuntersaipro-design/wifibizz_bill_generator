import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

const R2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME!;

export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<string> {
  await R2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

export async function deleteFromR2(key: string): Promise<void> {
  await R2.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    })
  );
}

export async function getFromR2(
  key: string
): Promise<ReadableStream | null> {
  const res = await R2.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    })
  );
  return (res.Body?.transformToWebStream() as ReadableStream) ?? null;
}

/**
 * The whole object as bytes, or null when the key does not exist.
 *
 * A missing key is an ordinary outcome for callers that DERIVE a key rather
 * than reading one back from the database — an e-RF is only there if the run
 * that would have produced it got as far as Pay — so it is reported as absence
 * rather than raised.
 */
export async function getBytesFromR2(key: string): Promise<Uint8Array | null> {
  try {
    const res = await R2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    return bytes ?? null;
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw e;
  }
}
