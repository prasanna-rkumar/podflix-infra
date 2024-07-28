import { Handler } from "aws-lambda";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { nanoid } from 'nanoid'
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import fs from "fs";
import { spawnSync } from "child_process";
import { createClient } from "@deepgram/sdk";
import OpenAI from "openai";


const s3Client = new S3Client();
const ddbClient = new DynamoDBClient();
const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY ?? "");
const openaiClient = new OpenAI({
  organization: process.env.OPENAI_ORG_ID,
  apiKey: process.env.OPENAI_API_KEY,
});

export const handler: Handler = (async (event) => {
  try {

    const { video, range, username } = event;
    const extension = video.s3_audio_key.split('.').pop();

    const getObjectCommand = new GetObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: video.s3_audio_key,
    });

    const resp = await s3Client.send(getObjectCommand);
    const filePath = `/tmp/${nanoid(10)}.${extension}`;
    if (!resp.Body) {
      throw new Error("Eror downloading audio clip");
    }
    const blob = await resp.Body.transformToByteArray();
    fs.writeFileSync(filePath, blob);

    const clipPath = clipAudioClip(filePath, extension, range);
    const clipBuffer = fs.readFileSync(clipPath);
    const clipKey = `audio/${nanoid(10)}.${extension}`;
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: clipKey,
      Body: clipBuffer
    });
    await s3Client.send(uploadCommand);

    const deepgramResponse = await deepgramClient.listen.prerecorded.transcribeFile(
      clipBuffer,
      {
        model: "nova-2",
        smart_format: true,
        diarize: true,
        punctuate: true,
      }
    );

    let captions: any[] = [];
    let descriptions: string[] = [];
    if (!deepgramResponse.error) {
      captions = deepgramResponse.result.results.channels[0].alternatives[0].words;

      const paragraph = deepgramResponse.result.results.channels[0].alternatives[0].paragraphs?.paragraphs.map((p) => p.sentences.map(s => s.text)).join(" ");

      console.log(paragraph);

      if (paragraph) {
        const openaiResponse = await openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          n: 3,
          messages: [
            {
              role: "system",
              content: "You are a language model that provides direct and concise outputs. Your task is to generate engaging and concise captions for social media platforms like Instagram, YouTube, and others, based on a podcast title and a minute-long audio snippet."
            },
            {
              role: "user",
              content: `Title: ${video.title}\nAudio snippet transcription: ${paragraph}\n\nGenerate a caption for social media that is Attention-grabbing, Engaging and informative, Reflective of the podcast's tone and content, Suitable for platforms like Instagram and YouTube`
            }
          ],
          stream: false,
        });

        console.log(JSON.stringify(openaiResponse.choices));

        descriptions = openaiResponse.choices.map((choice) => choice.message.content).filter(d => d !== null);

      }

    }

    const updateCommand = new UpdateItemCommand({
      Key: {
        PK: { S: `USERNAME#${username}` },
        SK: { S: `VIDEO#${video.video_id}` }
      },
      "UpdateExpression": "SET #audio_clip_url = :audio_clip_url, #audio_status = :audio_status, #captions = :captions, #descriptions = :descriptions",
      ExpressionAttributeNames: {
        "#audio_clip_url": "audio_clip_url",
        "#audio_status": "audio_status",
        "#captions": "captions",
        "#descriptions": "descriptions"
      },
      ExpressionAttributeValues: {
        ":audio_clip_url": { S: clipKey },
        ":audio_status": { S: "READY" },
        ":captions": {
          L: captions.map((word) => ({
            M: {
              word: { S: word.word },
              start: { N: word.start.toString() },
              end: { N: word.end.toString() },
              speaker: { N: word.speaker.toString() },
              punctuated_word: { S: word.punctuated_word }
            }
          }))
        },
        ":descriptions": {
          L: descriptions.map((description) => ({
            S: description
          }))
        }
      },
      TableName: process.env.TABLE_NAME ?? "",
    });

    await ddbClient.send(updateCommand);

    console.log({
      success: true,
      audio_clip_url: clipKey,
    })

    return {
      success: true,
      audio_clip_url: clipKey,
    }

  } catch (e) {
    console.error(e);
    return {
      success: false,
    }
  }
});

function clipAudioClip(filePath: string, extension: string, range: number[]) {

  const clipPath = `/tmp/${nanoid(10)}.${extension}`;

  const processss = spawnSync(
    "ls",
    [
      "/opt"
    ],
    { shell: true, stdio: "inherit" }
  )

  const processsss = spawnSync(
    "ls",
    [
      "/opt/ffmpeg"
    ],
    { shell: true, stdio: "inherit" }
  )

  const child = spawnSync(
    process.env.FFMPEG_COMMAND ?? "",
    [
      "-i", filePath,
      "-ss", range[0].toString(),
      "-to", range[1].toString(),
      "-c", "copy",
      clipPath
    ],
    { shell: true, stdio: "inherit" }
  );

  return clipPath;
}
