import { spawnSync } from "child_process";


const getAudioFileDuration = (filePath) => {

  // /opt/ffmpeg/
  var child = spawnSync(
    "./ffprobe",
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

  console.log("command", "./ffprobe", "./ffprobe",
    [
      "-i",
      filePath,
      '-show_entries',
      'format=duration',
      '-v',
      'quiet',
      '-of',
      `csv`
    ].join(" "))

  console.log(child.stdout.toString())
  const output = child.stdout.toString().split(',')[1];
  const duration = Math.floor(parseInt(output));

  return duration || 0;
}

const duration = getAudioFileDuration("/tmp/frNuC0zg7D.m4a")