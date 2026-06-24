import * as fs from 'fs/promises';

import { writeMCPLog } from '../mcp-logger.js';
import { PLATFORM } from './constants.js';
import { getDisplayConfiguration } from './display.js';
import type { BoundingBox } from './types.js';
import { callVisionAPI } from './vision-api.js';
import { annotateScreenshotWithClickHistory, getImageDimensions } from './vision-annotate.js';

export async function analyzeScreenshotWithVision(
  screenshotPath: string,
  elementDescription: string,
  displayIndex?: number
): Promise<{
  x: number;
  y: number;
  confidence: number;
  displayIndex: number;
  boundingBox?: BoundingBox;
}> {
  try {
    const config = await getDisplayConfiguration();
    const targetDisplay =
      displayIndex !== undefined
        ? config.displays.find((display) => display.index === displayIndex)
        : config.displays.find((display) => display.isMain);

    if (!targetDisplay) {
      throw new Error(`Display index ${displayIndex} not found`);
    }

    const { annotatedPath, clickHistoryInfo } = await annotateScreenshotWithClickHistory(
      screenshotPath,
      targetDisplay.index
    );

    writeMCPLog(
      `[analyzeScreenshotWithVision] Using screenshot: ${annotatedPath}`,
      'Screenshot Selection'
    );
    writeMCPLog(
      `[analyzeScreenshotWithVision] Click history: ${clickHistoryInfo}`,
      'Click History'
    );

    const imageBuffer = await fs.readFile(annotatedPath);
    const base64Image = imageBuffer.toString('base64');
    const imageDims = await getImageDimensions(annotatedPath);

    const prompt = `给我${elementDescription}的grounding坐标。

**注意**：图片上可能有黄色圆圈标记，这些是之前点击过的位置（仅用于相对位置参考，它们并不一定是正确的点击位置），标记格式为"#序号"和已经归一化之后的"[y,x]"坐标。这些标记不是界面的一部分，请忽略它们，只定位实际的界面元素。

坐标格式：归一化到0-1000，格式为[ymin, xmin, ymax, xmax]

返回JSON（不要markdown）:
{"box_2d": [ymin, xmin, ymax, xmax], "confidence": <0-100>}`;

    writeMCPLog(`[analyzeScreenshotWithVision] Prompt: ${prompt}`);

    const responseText = await callVisionAPI(
      base64Image,
      prompt,
      20000,
      'analyzeScreenshotWithVision'
    );
    writeMCPLog(
      `[analyzeScreenshotWithVision] Raw Response Length: ${responseText.length}`,
      'Response'
    );
    writeMCPLog(
      `[analyzeScreenshotWithVision] Raw Response (first 500 chars): ${responseText.substring(0, 500)}`,
      'Response Preview'
    );

    let jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      writeMCPLog(
        '[analyzeScreenshotWithVision] No JSON found with simple regex, trying code block pattern',
        'Parse Attempt'
      );
      const codeBlockMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        jsonMatch = [codeBlockMatch[1]];
        writeMCPLog(
          `[analyzeScreenshotWithVision] Found JSON in code block, length: ${jsonMatch[0].length}`,
          'Parse Success'
        );
      }
    } else {
      writeMCPLog(
        `[analyzeScreenshotWithVision] Found JSON with simple regex, length: ${jsonMatch[0].length}`,
        'Parse Success'
      );
    }

    if (!jsonMatch) {
      writeMCPLog(
        `[analyzeScreenshotWithVision] Failed to find JSON in response. Full response: ${responseText}`,
        'Parse Error'
      );
      throw new Error('Failed to parse vision model response: No JSON found in response');
    }

    let result;
    try {
      writeMCPLog(
        `[analyzeScreenshotWithVision] Attempting to parse JSON (first 200 chars): ${jsonMatch[0].substring(0, 200)}`,
        'JSON Parse'
      );
      result = JSON.parse(jsonMatch[0]);
      writeMCPLog('[analyzeScreenshotWithVision] JSON parsed successfully', 'JSON Parse Success');
    } catch (parseError: unknown) {
      writeMCPLog(
        `[analyzeScreenshotWithVision] JSON parse failed: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        'JSON Parse Error'
      );
      writeMCPLog(
        `[analyzeScreenshotWithVision] JSON string that failed to parse: ${jsonMatch[0]}`,
        'JSON Parse Error'
      );
      throw new Error(
        `Failed to parse JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}. JSON string: ${jsonMatch[0].substring(0, 500)}`
      );
    }

    if (!result.box_2d || !Array.isArray(result.box_2d) || result.box_2d.length !== 4) {
      writeMCPLog(
        `[analyzeScreenshotWithVision] Invalid box_2d in response: ${JSON.stringify(result)}`,
        'Parse Error'
      );
      throw new Error(
        'Vision response missing or invalid box_2d field. Expected format: [ymin, xmin, ymax, xmax]'
      );
    }

    const [ymin_norm, xmin_norm, ymax_norm, xmax_norm] = result.box_2d;
    writeMCPLog(
      `[analyzeScreenshotWithVision] Normalized box (0-1000): [ymin=${ymin_norm}, xmin=${xmin_norm}, ymax=${ymax_norm}, xmax=${xmax_norm}]`,
      'Normalized Coordinates'
    );

    const xmin_pixel = Math.round((xmin_norm / 1000) * imageDims.width);
    const ymin_pixel = Math.round((ymin_norm / 1000) * imageDims.height);
    const xmax_pixel = Math.round((xmax_norm / 1000) * imageDims.width);
    const ymax_pixel = Math.round((ymax_norm / 1000) * imageDims.height);

    writeMCPLog(
      `[analyzeScreenshotWithVision] Pixel coordinates: xmin=${xmin_pixel}, ymin=${ymin_pixel}, xmax=${xmax_pixel}, ymax=${ymax_pixel}`,
      'Pixel Coordinates'
    );
    writeMCPLog(
      `[analyzeScreenshotWithVision] Image dimensions: ${imageDims.width}x${imageDims.height}`,
      'Image Info'
    );

    const pixelCenterX = Math.round((xmin_pixel + xmax_pixel) / 2);
    const pixelCenterY = Math.round((ymin_pixel + ymax_pixel) / 2);
    writeMCPLog(
      `[analyzeScreenshotWithVision] Calculated center from bounding box (pixels): x=${pixelCenterX}, y=${pixelCenterY}`,
      'Center Calculation'
    );

    const rawScaleFactor = targetDisplay.scaleFactor || 1;
    const effectiveScaleFactor = PLATFORM === 'win32' ? 1 : rawScaleFactor;
    writeMCPLog(
      `[analyzeScreenshotWithVision] Display scaleFactor: ${rawScaleFactor}, effective (platform=${PLATFORM}): ${effectiveScaleFactor}`,
      'Coordinate Conversion'
    );

    const logicalX = pixelCenterX / effectiveScaleFactor;
    const logicalY = pixelCenterY / effectiveScaleFactor;
    writeMCPLog(
      `[analyzeScreenshotWithVision] Logical coordinates for cliclick: x=${logicalX}, y=${logicalY}`,
      'Coordinate Conversion'
    );

    return {
      x: Math.round(logicalX),
      y: Math.round(logicalY),
      confidence: result.confidence || 0,
      displayIndex: targetDisplay.index,
      boundingBox: {
        left: xmin_pixel,
        top: ymin_pixel,
        right: xmax_pixel,
        bottom: ymax_pixel,
      },
    };
  } catch (error: unknown) {
    throw new Error(
      `Vision analysis failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
