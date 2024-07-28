import { Handler } from "aws-lambda";
import { spawnSync } from "child_process";
import fs from "fs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { nanoid } from 'nanoid'
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

const s3Client = new S3Client();
const ddbClient = new DynamoDBClient();

export const handler: Handler = (async (event) => {

  try {
    const { episodeId, username } = event;
    const { rss_audio_url: audioUrl } = event.episode;

    let audioUrlObject;
    try {
      audioUrlObject = new URL(audioUrl);
    } catch (e) {
      console.error("Invalid URL", e);
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Invalid URL"
        })
      }
    }
    const audioFileExtension = audioUrlObject.pathname.split('.').pop();

    const audioResponse = await fetch(audioUrl);
    const audioArrayBuffer = await audioResponse.arrayBuffer()
    const audioUint8Array = new Uint8Array(audioArrayBuffer);
    const audioBuffer = Buffer.from(audioUint8Array);

    const filePath = `/tmp/${nanoid(10)}.${audioFileExtension}`;
    fs.writeFileSync(filePath, audioBuffer);

    const fileKey = `audio/${nanoid(10)}.${audioFileExtension}`;

    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: fileKey,
      Body: audioBuffer
    });

    await s3Client.send(uploadCommand);

    const duration = getAudioFileDuration(filePath);

    const updateCommand = new UpdateItemCommand({
      Key: {
        PK: { S: `USERNAME#${username}` },
        SK: { S: `EPISODE#${episodeId}` }
      },
      "UpdateExpression": "SET #s3_audio_key = :s3_audio_key, #duration = :duration, #audio_status = :audio_status",
      ExpressionAttributeNames: {
        "#s3_audio_key": "s3_audio_key",
        "#audio_status": "audio_status",
        "#duration": "duration"
      },
      ExpressionAttributeValues: {
        ":s3_audio_key": { S: fileKey },
        ":audio_status": { S: "READY" },
        ":duration": { N: duration.toString() }
      },
      TableName: process.env.TABLE_NAME,
    });

    await ddbClient.send(updateCommand);

    return {
      success: true,
      fileKey: fileKey
    };
  } catch (e) {
    console.error(e);
    return {
      success: false,
    }
  }

});

const getAudioFileDuration = (filePath: string): number => {

  var child = spawnSync(
    process.env.FFPROBE_COMMAND ?? "ffprobe",
    [
      "-i",
      filePath,
      '-show_entries',
      'format=duration',
      '-v',
      'quiet',
      '-of',
      `csv`
    ],
    { shell: true }
  );

  const output = child.stdout.toString().split(',')[1];
  const duration = Math.floor(parseInt(output));

  return duration || 0;
}
