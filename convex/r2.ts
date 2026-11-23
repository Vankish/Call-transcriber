import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { fail } from "./errors";

/**
 * Lo único que la nube le pide a Cloudflare R2, detrás de una interfaz pequeña
 * para que las pruebas pongan una falsa en su lugar (no hay R2 en `convex-test`).
 *
 * Se usa el SDK de S3 directamente y no `@convex-dev/r2`: ese componente sube
 * archivos de una pieza (PutObject) y no hace multipart, que es lo que permite
 * reanudar un vídeo de 500 MB a medias. Corre en el runtime normal de Convex
 * (sin "use node"), igual que el propio componente.
 *
 * Variables: R2_BUCKET, R2_ENDPOINT (https://<cuenta>.r2.cloudflarestorage.com),
 * R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
 */
export type R2Port = {
  createMultipart: (key: string, contentType: string) => Promise<string>;
  signPart: (
    key: string,
    uploadId: string,
    partNumber: number,
    expiresInSec: number,
  ) => Promise<string>;
  completeMultipart: (
    key: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
  ) => Promise<void>;
  abortMultipart: (key: string, uploadId: string) => Promise<void>;
  signGet: (key: string, expiresInSec: number) => Promise<string>;
};

// Código propio y no el genérico `not_configured`: la app y la web lo enseñan
// como "falta configurar el almacenamiento", y la cola de subidas del escritorio
// deja de insistir (no se arregla solo; hace falta que el dueño ponga R2).
const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw fail(
      "storage_not_configured",
      `Falta configurar el almacenamiento en la nube (${name} en el despliegue).`,
    );
  }
  return value.trim();
};

const s3Port = (): R2Port => {
  const bucket = required("R2_BUCKET");
  const client = new S3Client({
    region: "auto",
    endpoint: required("R2_ENDPOINT"),
    credentials: {
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    },
    // Desde la 3.729 el SDK mete sumas CRC32 en cada parte por defecto. En una
    // URL firmada eso obliga a quien sube a mandar la misma suma, y la app no
    // la calcula: se piden solo cuando la operación las exige.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return {
    createMultipart: async (key, contentType) => {
      const out = await client.send(
        new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      );
      if (out.UploadId === undefined) throw new Error("R2 no devolvió UploadId");
      return out.UploadId;
    },
    signPart: (key, uploadId, partNumber, expiresIn) =>
      getSignedUrl(
        client,
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn },
      ),
    completeMultipart: async (key, uploadId, parts) => {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
          },
        }),
      );
    },
    abortMultipart: async (key, uploadId) => {
      await client.send(
        new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
      );
    },
    signGet: (key, expiresIn) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn }),
  };
};

let testPort: R2Port | null = null;
let realPort: R2Port | null = null;

/** Solo para pruebas: sustituye R2 por una versión en memoria. */
export const setR2ForTesting = (port: R2Port | null): void => {
  testPort = port;
};

export const r2 = (): R2Port => testPort ?? (realPort ??= s3Port());
