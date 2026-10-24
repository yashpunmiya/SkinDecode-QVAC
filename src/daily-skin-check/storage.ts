import * as SQLite from 'expo-sqlite';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { localDateKey } from '../routine/models';
import type { DailySkinCheck, MetricRatings } from './rules';

const HISTORY_DAYS = 30;
const PHOTO_DIRECTORY_NAME = 'daily-skin-check';
let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

export type FaceCropBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
};

type DailySkinCheckRow = {
  user_id: string;
  local_date: string;
  acne: number;
  redness: number;
  dryness: number;
  oiliness: number;
  irritation: number;
  am_routine_completed: number;
  pm_routine_completed: number;
  new_product_started: number;
  note: string | null;
  photo_uri: string | null;
  updated_at: string;
};

function toDailySkinCheck(row: DailySkinCheckRow): DailySkinCheck {
  return {
    userId: row.user_id,
    localDate: row.local_date,
    ratings: {
      acne: row.acne,
      redness: row.redness,
      dryness: row.dryness,
      oiliness: row.oiliness,
      irritation: row.irritation,
    },
    amRoutineCompleted: Boolean(row.am_routine_completed),
    pmRoutineCompleted: Boolean(row.pm_routine_completed),
    newProductStarted: Boolean(row.new_product_started),
    photoUri: row.photo_uri,
    updatedAt: row.updated_at,
  };
}

async function openDailySkinCheckDatabase() {
  if (!databasePromise) {
    databasePromise = (async () => {
      const database = await SQLite.openDatabaseAsync('skindecode-daily-skin-check.db');
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS daily_skin_checkins (
          user_id TEXT NOT NULL,
          local_date TEXT NOT NULL,
          acne INTEGER NOT NULL CHECK(acne BETWEEN 1 AND 5),
          redness INTEGER NOT NULL CHECK(redness BETWEEN 1 AND 5),
          dryness INTEGER NOT NULL CHECK(dryness BETWEEN 1 AND 5),
          oiliness INTEGER NOT NULL CHECK(oiliness BETWEEN 1 AND 5),
          irritation INTEGER NOT NULL CHECK(irritation BETWEEN 1 AND 5),
          am_routine_completed INTEGER NOT NULL DEFAULT 0 CHECK(am_routine_completed IN (0,1)),
          pm_routine_completed INTEGER NOT NULL DEFAULT 0 CHECK(pm_routine_completed IN (0,1)),
          new_product_started INTEGER NOT NULL DEFAULT 0 CHECK(new_product_started IN (0,1)),
          note TEXT,
          photo_uri TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(user_id, local_date)
        );
        CREATE INDEX IF NOT EXISTS daily_skin_checkins_date_idx ON daily_skin_checkins(local_date DESC);
      `);
      return database;
    })().catch((error) => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
}

export function yesterdayDateKey(date = new Date()) {
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);
  return localDateKey(yesterday);
}

function cutoffDateKey(date: Date) {
  const cutoff = new Date(date);
  cutoff.setDate(cutoff.getDate() - (HISTORY_DAYS - 1));
  return localDateKey(cutoff);
}

function photoDirectory() {
  return new Directory(Paths.document, PHOTO_DIRECTORY_NAME);
}

function faceFocusedSquareCrop(width: number, height: number, face?: FaceCropBounds | null) {
  const fallbackSide = Math.min(width, height);
  if (!face || face.frameWidth <= 0 || face.frameHeight <= 0 || face.width <= 0 || face.height <= 0) {
    return {
      originX: Math.round((width - fallbackSide) / 2),
      originY: Math.round((height - fallbackSide) / 2),
      width: fallbackSide,
      height: fallbackSide,
    };
  }

  const photoAspect = width / height;
  const frameAspect = face.frameWidth / face.frameHeight;
  let x = face.x / face.frameWidth;
  let y = face.y / face.frameHeight;
  let faceWidth = face.width / face.frameWidth;
  let faceHeight = face.height / face.frameHeight;
  if (Math.abs(photoAspect - 1 / frameAspect) < Math.abs(photoAspect - frameAspect)) {
    // The captured image is rotated 90 degrees relative to the detector frame.
    const rotatedX = 1 - y - faceHeight;
    y = x;
    x = rotatedX;
    [faceWidth, faceHeight] = [faceHeight, faceWidth];
  }

  const faceX = Math.max(0, Math.min(1, x)) * width;
  const faceY = Math.max(0, Math.min(1, y)) * height;
  const facePixelWidth = Math.max(1, Math.min(1, faceWidth) * width);
  const facePixelHeight = Math.max(1, Math.min(1, faceHeight) * height);
  // Keep the full detected face with comfortable forehead/chin and cheek margin.
  const side = Math.min(fallbackSide, Math.max(facePixelWidth * 1.45, facePixelHeight * 1.12));
  const centerX = faceX + facePixelWidth / 2;
  const centerY = faceY + facePixelHeight / 2;
  const originX = Math.max(0, Math.min(width - side, centerX - side / 2));
  const originY = Math.max(0, Math.min(height - side, centerY - side / 2));
  return {
    originX: Math.round(originX),
    originY: Math.round(originY),
    width: Math.round(side),
    height: Math.round(side),
  };
}

export async function saveDailySkinPhoto(sourceUri: string, width: number, height: number, face?: FaceCropBounds | null): Promise<string> {
  const crop = faceFocusedSquareCrop(width, height, face);
  const cropSide = Math.min(crop.width, crop.height);
  const cropX = crop.originX;
  const cropY = crop.originY;
  const scale = cropSide > 1280 ? 1280 / cropSide : 1;
  const image = ImageManipulator.manipulate(sourceUri);
  if (cropX || cropY || cropSide !== width || cropSide !== height) image.crop({ originX: cropX, originY: cropY, width: cropSide, height: cropSide });
  if (scale < 1) image.resize({ width: Math.round(cropSide * scale), height: Math.round(cropSide * scale) });
  const rendered = await image.renderAsync();
  const compressed = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.72 });

  const directory = photoDirectory();
  if (!directory.exists) directory.create({ idempotent: true, intermediates: true });
  const name = `skin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const savedFile = new File(directory, name);
  const temporaryFile = new File(compressed.uri);
  try {
    await temporaryFile.copy(savedFile);
    return savedFile.uri;
  } catch (error) {
    if (savedFile.exists) savedFile.delete();
    throw error;
  } finally {
    if (temporaryFile.exists) temporaryFile.delete();
  }
}

export async function deleteDailySkinPhotoFile(uri: string | null | undefined): Promise<boolean> {
  if (!uri) return true;
  try {
    if (!uri.startsWith(photoDirectory().uri)) return false;
    const file = new File(uri);
    if (file.exists) file.delete();
    return !file.exists;
  } catch (error) {
    console.warn('[daily-skin-check] local photo cleanup failed', error);
    return false;
  }
}

async function pruneOldDailySkinChecks(database: SQLite.SQLiteDatabase, date: Date) {
  const cutoff = cutoffDateKey(date);
  const oldRows = await database.getAllAsync<{ photo_uri: string | null }>(
    'SELECT photo_uri FROM daily_skin_checkins WHERE local_date < ?', cutoff,
  );
  await database.runAsync('DELETE FROM daily_skin_checkins WHERE local_date < ?', cutoff);
  await Promise.all(oldRows.map((row) => deleteDailySkinPhotoFile(row.photo_uri)));
}

async function getCheckin(database: SQLite.SQLiteDatabase, userId: string, dateKey: string) {
  const row = await database.getFirstAsync<DailySkinCheckRow>(
    'SELECT * FROM daily_skin_checkins WHERE user_id = ? AND local_date = ?', userId, dateKey,
  );
  return row ? toDailySkinCheck(row) : null;
}

export async function loadDailySkinCheckPair(userId: string, today = new Date()) {
  const database = await openDailySkinCheckDatabase();
  await pruneOldDailySkinChecks(database, today);
  const todayKey = localDateKey(today);
  const yesterdayKey = yesterdayDateKey(today);
  const [todayCheckin, yesterdayCheckin] = await Promise.all([
    getCheckin(database, userId, todayKey),
    getCheckin(database, userId, yesterdayKey),
  ]);
  return { today: todayCheckin, yesterday: yesterdayCheckin };
}

export async function loadDailySkinCheckHistory(userId: string, today = new Date()) {
  const database = await openDailySkinCheckDatabase();
  await pruneOldDailySkinChecks(database, today);
  const todayKey = localDateKey(today);
  const fromDateKey = cutoffDateKey(today);
  const rows = await database.getAllAsync<DailySkinCheckRow>(
    `SELECT * FROM daily_skin_checkins
     WHERE user_id = ? AND local_date >= ? AND local_date <= ?
     ORDER BY local_date DESC LIMIT ?`,
    userId, fromDateKey, todayKey, HISTORY_DAYS,
  );
  return rows.map(toDailySkinCheck);
}

export async function saveDailySkinCheck(checkin: DailySkinCheck) {
  const database = await openDailySkinCheckDatabase();
  const previous = await getCheckin(database, checkin.userId, checkin.localDate);
  const ratings: MetricRatings = checkin.ratings;
  await database.runAsync(
    `INSERT INTO daily_skin_checkins (
      user_id,local_date,acne,redness,dryness,oiliness,irritation,
      am_routine_completed,pm_routine_completed,new_product_started,note,photo_uri,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,local_date) DO UPDATE SET
      acne=excluded.acne,redness=excluded.redness,dryness=excluded.dryness,
      oiliness=excluded.oiliness,irritation=excluded.irritation,
      am_routine_completed=excluded.am_routine_completed,pm_routine_completed=excluded.pm_routine_completed,
      new_product_started=excluded.new_product_started,note=excluded.note,photo_uri=excluded.photo_uri,updated_at=excluded.updated_at`,
    checkin.userId, checkin.localDate, ratings.acne, ratings.redness, ratings.dryness, ratings.oiliness, ratings.irritation,
    checkin.amRoutineCompleted ? 1 : 0, checkin.pmRoutineCompleted ? 1 : 0, checkin.newProductStarted ? 1 : 0,
    null, checkin.photoUri, new Date().toISOString(),
  );
  if (previous?.photoUri && previous.photoUri !== checkin.photoUri) await deleteDailySkinPhotoFile(previous.photoUri);
  await pruneOldDailySkinChecks(database, new Date(`${checkin.localDate}T12:00:00`));
  return getCheckin(database, checkin.userId, checkin.localDate);
}

export async function deleteDailySkinCheck(userId: string, dateKey: string) {
  const database = await openDailySkinCheckDatabase();
  const previous = await getCheckin(database, userId, dateKey);
  await database.runAsync('DELETE FROM daily_skin_checkins WHERE user_id = ? AND local_date = ?', userId, dateKey);
  await deleteDailySkinPhotoFile(previous?.photoUri);
}

export async function deleteDailySkinCheckPhoto(userId: string, dateKey: string) {
  const database = await openDailySkinCheckDatabase();
  const previous = await getCheckin(database, userId, dateKey);
  await database.runAsync(
    'UPDATE daily_skin_checkins SET photo_uri = NULL, updated_at = ? WHERE user_id = ? AND local_date = ?',
    new Date().toISOString(), userId, dateKey,
  );
  await deleteDailySkinPhotoFile(previous?.photoUri);
}

export async function deleteUserDailySkinData(userId: string) {
  const database = await openDailySkinCheckDatabase();
  const rows = await database.getAllAsync<{ photo_uri: string | null }>(
    'SELECT photo_uri FROM daily_skin_checkins WHERE user_id = ?', userId,
  );
  await database.runAsync('DELETE FROM daily_skin_checkins WHERE user_id = ?', userId);
  const filesRemoved = await Promise.all(rows.map((row) => deleteDailySkinPhotoFile(row.photo_uri)));
  if (filesRemoved.some((removed) => !removed)) throw new Error('Some local check-in photos could not be removed.');
}
