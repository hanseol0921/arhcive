import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const required = [
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_ENDPOINT",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
];

const missing = required.filter((name) => !process.env[name]?.trim());

if (missing.length > 0) {
  console.error(`누락된 설정: ${missing.join(", ")}`);
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT.replace(/\/$/, ""),
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

try {
  const result = await client.send(
    new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET,
      MaxKeys: 1,
    }),
  );

  console.log(`R2 연결 성공: ${process.env.R2_BUCKET}`);
  console.log(`버킷에 객체가 있음: ${result.KeyCount > 0 ? "예" : "아니요"}`);
} catch (error) {
  console.error("R2 연결 실패");
  console.error(error?.name || "UnknownError");
  console.error(error?.message || String(error));
  process.exit(1);
}
