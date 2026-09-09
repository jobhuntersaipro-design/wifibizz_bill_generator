import "dotenv/config";
import { writeFileSync } from "node:fs";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { createTaAuthContext } from "@/lib/bill-generator/landlord-signature";
import { generateTenancyAgreement } from "@/lib/bill-generator/tenancy-agreement";
import { getBytesFromR2 } from "@/lib/r2";

async function main() {
  const rows = await prisma.landlordSignatureImage.findMany({
    orderBy: { id: "asc" },
    select: { id: true, filename: true, contentType: true, r2Key: true },
  });
  const r2 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  const listed = await r2.send(
    new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      Prefix: "landlord-signatures/",
    }),
  );
  console.log("r2_count", (listed.Contents ?? []).length);
  for (const o of listed.Contents ?? []) {
    console.log("r2", o.Key, o.Size, o.LastModified?.toISOString());
  }

  console.log("pool_count", rows.length);
  for (const row of rows) {
    const bytes = await getBytesFromR2(row.r2Key);
    if (!bytes) {
      console.log("FAIL", row.id, row.filename, "r2 miss");
      continue;
    }
    const meta = await sharp(bytes).metadata();
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    console.log(
      "img",
      row.id.slice(0, 8),
      row.filename,
      row.contentType,
      `${meta.width}x${meta.height}`,
      "bytes",
      bytes.length,
      "hash",
      hash,
    );
  }

  const ctx = await createTaAuthContext({
    tenantName: "Nazurah Afrina Binti Aliakbar",
    partiesSeed: 2026090901,
  });
  console.log("loaded_signatures", ctx.signatures.length);
  for (const [i, sig] of ctx.signatures.entries()) {
    const meta = await sharp(sig.bytes).metadata();
    console.log("slot", i, sig.mime, `${meta.width}x${meta.height}`, "bytes", sig.bytes.length);
  }

  const pdf = await generateTenancyAgreement(
    {
      case_no: "202666996",
      full_name: "Nazurah Afrina Binti Aliakbar",
      id_no: "011023120384",
      full_address: "LOT 978 KAMPUNG PASIR PANDAK, 32020 SITIAWAN, PERAK, MALAYSIA",
    },
    undefined,
    ctx.now,
    ctx.rng,
    { parties: ctx.parties, signatures: ctx.signatures },
  );
  writeFileSync("/tmp/ta-repro-missing-ll.pdf", pdf);
  console.log("wrote_pdf", pdf.length);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
