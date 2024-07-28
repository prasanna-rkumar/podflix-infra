import fs from "fs";
const WORDS_IN_FRAME = 6;
const MAX_CHARACTERS_IN_FRAME = 40;

const sample = JSON.parse(fs.readFileSync("sample-subs.json"));
const captions = sample[0].result.data.json;

const subsPerFrame = [];

let frameTemp = [];
for (let i = 0; i < captions.length; i++) {
  if (
    frameTemp.length < WORDS_IN_FRAME &&
    frameTemp.map((frame) => frame.punctuated_word).join(" ").length < MAX_CHARACTERS_IN_FRAME &&
    ![...frameTemp].pop()?.punctuated_word.endsWith(".")
  ) {
    frameTemp.push(captions[i]);
  } else {
    subsPerFrame.push(frameTemp);
    frameTemp = [];
    i--;
  }
}

fs.writeFileSync("sample-subs-per-frame.json", JSON.stringify(subsPerFrame));

