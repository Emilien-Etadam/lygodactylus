import * as fs from 'fs/promises';
import * as path from 'path';

import { writeMCPLog } from '../mcp-logger.js';
import { takeScreenshot } from './actions.js';
import { PLATFORM, SCREENSHOTS_DIR } from './constants.js';
import { getDisplayConfiguration } from './display.js';
import { tryLocateElementInDockByAccessibility } from './mac-platform.js';
import type { GUIActionPlan, LocateResult } from './types.js';
import { callVisionAPI } from './vision-api.js';
import { getImageDimensions, markPointOnImage } from './vision-annotate.js';
import { analyzeScreenshotWithVision } from './vision-analyze.js';

export async function planGUIActions(
  taskDescription: string,
  displayIndex?: number
): Promise<GUIActionPlan> {
  if (PLATFORM !== 'darwin' && PLATFORM !== 'win32') {
    throw new Error(`GUI action planning is not supported on platform: ${PLATFORM}`);
  }

  const screenshotPath = path.join(SCREENSHOTS_DIR, `gui_plan_${Date.now()}.png`);
  await takeScreenshot(screenshotPath, displayIndex);

  const imageDims = await getImageDimensions(screenshotPath);
  const imageBuffer = await fs.readFile(screenshotPath);
  const base64Image = imageBuffer.toString('base64');

  const prompt = `Analyze this GUI screenshot and create a step-by-step plan to accomplish the following task: "${taskDescription}"

**COORDINATE SYSTEM:**
- Image dimensions: ${imageDims.width}x${imageDims.height} pixels
- Origin (0,0) is at TOP-LEFT corner

**TASK:**
Break down the task "${taskDescription}" into a sequence of GUI operations.

**INSTRUCTIONS:**
1. Analyze the current GUI state shown in the screenshot
2. Identify what elements need to be interacted with
3. Create a step-by-step plan with specific actions
4. For each step, describe the element to interact with and what action to perform
5. Include any text values that need to be entered

**AVAILABLE ACTIONS:**
- click: Single click on an element
- double_click: Double click on an element
- right_click: Right click on an element
- type: Type text into an input field (requires value parameter)
- hover: Move mouse over an element
- key_press: Press a key (requires value parameter with key name)

**RESPONSE FORMAT (JSON only, no markdown):**
{
  "steps": [
    {
      "step": 1,
      "action": "click|double_click|right_click|type|hover|key_press",
      "element_description": "<detailed description of the element to interact with>",
      "value": "<optional: text to type or key to press>",
      "reasoning": "<explanation of why this step is needed>"
    }
  ],
  "summary": "<brief summary of the plan>"
}

Be specific and detailed in element descriptions. For example:
- Instead of "button", use "the red Start button in the top-right corner"
- Instead of "input", use "the text input field labeled 'File Name'"
- Instead of "menu", use "the File menu in the menu bar"`;

  const responseText = await callVisionAPI(base64Image, prompt, 20000, 'planGUIActions');
  writeMCPLog(`[planGUIActions] Raw Response Length: ${responseText.length}`, 'Response');
  writeMCPLog(
    `[planGUIActions] Raw Response (first 500 chars): ${responseText.substring(0, 500)}`,
    'Response Preview'
  );

  let jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    writeMCPLog(
      '[planGUIActions] No JSON found with simple regex, trying code block pattern',
      'Parse Attempt'
    );
    const codeBlockMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
      jsonMatch = [codeBlockMatch[1]];
      writeMCPLog(
        `[planGUIActions] Found JSON in code block, length: ${jsonMatch[0].length}`,
        'Parse Success'
      );
    }
  } else {
    writeMCPLog(
      `[planGUIActions] Found JSON with simple regex, length: ${jsonMatch[0].length}`,
      'Parse Success'
    );
  }

  if (!jsonMatch) {
    writeMCPLog(
      `[planGUIActions] Failed to find JSON in response. Full response: ${responseText}`,
      'Parse Error'
    );
    throw new Error('Failed to parse action plan response: No JSON found in response');
  }

  let plan;
  try {
    writeMCPLog(
      `[planGUIActions] Attempting to parse JSON (first 200 chars): ${jsonMatch[0].substring(0, 200)}`,
      'JSON Parse'
    );
    plan = JSON.parse(jsonMatch[0]);
    writeMCPLog(
      `[planGUIActions] JSON parsed successfully. Steps count: ${plan.steps?.length || 0}`,
      'JSON Parse Success'
    );
  } catch (parseError: unknown) {
    writeMCPLog(
      `[planGUIActions] JSON parse failed: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      'JSON Parse Error'
    );
    writeMCPLog(
      `[planGUIActions] JSON string that failed to parse: ${jsonMatch[0]}`,
      'JSON Parse Error'
    );
    throw new Error(
      `Failed to parse action plan JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}. JSON string: ${jsonMatch[0].substring(0, 500)}`
    );
  }

  if (!plan.steps || !Array.isArray(plan.steps)) {
    writeMCPLog(
      `[planGUIActions] Invalid plan format. Plan keys: ${Object.keys(plan).join(', ')}, steps type: ${typeof plan.steps}`,
      'Validation Error'
    );
    throw new Error(
      `Invalid action plan format: missing steps array. Plan structure: ${JSON.stringify(plan, null, 2).substring(0, 500)}`
    );
  }

  return plan;
}

export async function locateGUIElement(
  elementDescription: string,
  displayIndex?: number
): Promise<LocateResult> {
  if (PLATFORM !== 'darwin' && PLATFORM !== 'win32') {
    throw new Error(`Element location is not supported on platform: ${PLATFORM}`);
  }

  if (PLATFORM === 'darwin') {
    try {
      const dockCoords = await tryLocateElementInDockByAccessibility(
        elementDescription,
        displayIndex
      );
      if (dockCoords) {
        return dockCoords;
      }
    } catch (dockError: unknown) {
      writeMCPLog(
        `[locateGUIElement] Dock accessibility lookup failed: ${dockError instanceof Error ? dockError.message : String(dockError)}`,
        'Dock Locate Warning'
      );
    }
  }

  const screenshotPath = path.join(SCREENSHOTS_DIR, `gui_locate_${Date.now()}.png`);
  await takeScreenshot(screenshotPath, displayIndex);

  const coords = await analyzeScreenshotWithVision(
    screenshotPath,
    elementDescription,
    displayIndex
  );

  try {
    const config = await getDisplayConfiguration();
    const targetDisplay =
      displayIndex !== undefined
        ? config.displays.find((display) => display.index === displayIndex)
        : config.displays.find((display) => display.isMain);

    if (targetDisplay) {
      const rawScaleFactor = targetDisplay.scaleFactor || 1;
      const effectiveScaleFactor = PLATFORM === 'win32' ? 1 : rawScaleFactor;
      const pixelX = coords.x * effectiveScaleFactor;
      const pixelY = coords.y * effectiveScaleFactor;

      writeMCPLog(
        `[locateGUIElement] Marking point on screenshot: logical=(${coords.x}, ${coords.y}), pixel=(${pixelX}, ${pixelY}), effectiveScale=${effectiveScaleFactor}`,
        'Image Marking'
      );

      const markedPath = await markPointOnImage(
        screenshotPath,
        pixelX,
        pixelY,
        undefined,
        coords.boundingBox
      );
      writeMCPLog(`[locateGUIElement] Marked screenshot saved to: ${markedPath}`, 'Image Marking');
    }
  } catch (markError: unknown) {
    writeMCPLog(
      `[locateGUIElement] Failed to mark screenshot: ${markError instanceof Error ? markError.message : String(markError)}`,
      'Image Marking Warning'
    );
  }

  return coords;
}
