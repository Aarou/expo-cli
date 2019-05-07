import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import chalk from 'chalk';
import sharp from 'sharp';
import glob from 'glob';
import JsonFile from '@expo/json-file';
import logger from './Logger';
import { readConfigJsonAsync } from './project/ProjectUtils';

/*
 * Converts a raw number of bytes into a human readable value
 */
export const toReadableValue = bytes => {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  const reduced = (bytes / Math.pow(1024, index)).toFixed(2) * 1;

  return `${reduced} ${sizes[index]}`;
};

/*
 * Calculate SHA256 Checksum value of a file based on its contents
 */
export const calculateHash = file => {
  const contents = fs.readFileSync(file);
  return crypto
    .createHash('sha256')
    .update(contents)
    .digest('hex');
};

/*
 * Compress an inputted jpg or png and save original copy with .expo extension
 */
export const optimizeImageAsync = async (image, newName, quality) => {
  logger.global.info(`Optimizing ${image}`);
  // Rename the file with .expo extension
  fs.copyFileSync(image, newName);

  // Extract the format and compress
  const buffer = await sharp(image).toBuffer();
  const { format } = await sharp(buffer).metadata();
  if (format === 'jpeg') {
    await sharp(newName)
      .jpeg({ quality })
      .toFile(image)
      .catch(err => logger.global.error(err));
  } else {
    await sharp(newName)
      .png({ quality })
      .toFile(image)
      .catch(err => logger.global.error(err));
  }
};

/*
 * Returns a boolean indicating whether or not there are assets to optimize
 */
export const hasUnoptimizedAssetsAsync = async (projectDir, options) => {
  if (!fs.existsSync(path.join(projectDir, '.expo-shared/assets.json'))) {
    return true;
  }
  const { selectedFiles } = await getAssetFilesAsync(projectDir, options);
  const { assetInfo } = await readAssetJsonAsync(projectDir);

  for (const file of selectedFiles) {
    const hash = calculateHash(file);
    if (!assetInfo[hash]) {
      return true;
    }
  }

  return false;
};

/*
 * Find all project assets under assetBundlePatterns in app.json excluding node_modules.
 * If --include of --exclude flags were passed in those results are filtered out.
 */
export const getAssetFilesAsync = async (projectDir, options) => {
  const { exp } = await readConfigJsonAsync(projectDir);
  const { assetBundlePatterns } = exp;
  const globOptions = { cwd: projectDir, ignore: '**/node_modules/**' };

  // All files must be returned even if flags are passed in to properly update assets.json
  const allFiles = [];
  assetBundlePatterns.forEach(pattern => {
    allFiles.push(...glob.sync(pattern, globOptions));
  });
  // If --include is passed in, only return files matching that pattern
  const included = options.include ? [...glob.sync(options.include, globOptions)] : allFiles;
  const toExclude = new Set();
  if (options.exclude) {
    glob.sync(options.exclude, globOptions).forEach(file => toExclude.add(file));
  }
  // If --exclude is passed in, filter out files matching that pattern
  const excluded = included.filter(file => !toExclude.has(file));
  const filtered = options.exclude ? excluded : included;
  return {
    allFiles: filterImages(allFiles, projectDir),
    selectedFiles: filterImages(filtered, projectDir),
  };
};

/*
 * Formats an array of files to include the project directory and filters out PNGs and JPGs.
 */
const filterImages = (files, projectDir) => {
  const regex = /\.(png|jpg|jpeg)$/;
  const withDirectory = files.map(file => `${projectDir}/${file}`.replace('//', '/'));
  const allImages = withDirectory.filter(file => regex.test(file.toLowerCase()));
  return allImages;
};

/*
 * Read the contents of assets.json under .expo-shared folder. Create the file/directory if they don't exist.
 */
export const readAssetJsonAsync = async projectDir => {
  const dirPath = path.join(projectDir, '.expo-shared');
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
  }

  const assetJson = new JsonFile(path.join(dirPath, 'assets.json'));
  if (!fs.existsSync(assetJson.file)) {
    const message =
      `Creating ${chalk.italic('.expo-shared/assets.json')} in the project's root directory.\n` +
      `This file is autogenerated and should not be edited directly.\n` +
      'You should commit this to git so that asset state is shared between collaborators.';

    logger.global.info(message);

    await assetJson.writeAsync({});
  }
  const assetInfo = await assetJson.readAsync();
  return { assetJson, assetInfo };
};

/*
 * Add .orig extension to a filename in a path string
 */
export const createNewFilename = image => {
  const { dir, name, ext } = path.parse(image);
  return dir + '/' + name + '.orig' + ext;
};
