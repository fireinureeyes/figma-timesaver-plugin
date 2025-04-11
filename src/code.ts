import { count } from 'console';
import { get } from 'http';
import * as JSZip from 'jszip';
import { cursorTo } from 'readline';

figma.showUI(__html__, { width: 1100, height: 370 });

type Variable = {
  collectionName: string;
  modeName: string;
  variableName: string;
  variableValue: any;
};

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'initialize-count') {
    figma.ui.postMessage({ type: 'loading', isLoading: true, count: 0, currentPageCount: 0 });
    const nodesToProcess = Array.from(figma.currentPage.findAll());
    const elements = [];
    for (let i = 0; i < nodesToProcess.length; i++) { 
      elements.push({
        id: nodesToProcess[i].id,
        name: nodesToProcess[i].name,
        pageName: getPageName(nodesToProcess[i]),
        selected: true
      });
      figma.ui.postMessage({ type: 'loading', isLoading: true, count: i, currentPageCount: nodesToProcess.length });

      // Pause every 100 frames for 40ms 
      if (i > 0 && i % 2000 === 0) {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    }
    figma.ui.postMessage({ type: 'update-element-count', count: elements.length, currentPageCount: elements.length, elements });
    figma.ui.postMessage({ type: 'loading', isLoading: false, count: elements.length });
  }

  if (msg.type === 'get-filename') {
    figma.ui.postMessage({ type: 'filename', fileName: figma.root.name });
  }

  if (msg.type === 'filter-elements') {
    // Pause every 100 frames for 40ms 
    await new Promise(resolve => setTimeout(resolve, 40));
    figma.ui.postMessage({ type: 'loading', isLoading: true });
    await new Promise(resolve => setTimeout(resolve, 40));
    const { objectScope, elementType, filters, action, newName, replaceText, exportScale, exportFormat, exportSuffix } = msg;
    let nodesToProcess: SceneNode[] = [];
    let currentPageCount = 0;

    if (elementType === 'STYLE') {
      try {
        const paintStyles: PaintStyle[] = await figma.getLocalPaintStylesAsync();
        const textStyles: TextStyle[] = await figma.getLocalTextStylesAsync();
        const effectStyles: EffectStyle[] = await figma.getLocalEffectStylesAsync();
        const gridStyles: GridStyle[] = await figma.getLocalGridStylesAsync();

        const styles = [...paintStyles, ...textStyles, ...effectStyles, ...gridStyles];

        const styleElements = styles.map(style => ({
          id: style.id,
          name: style.name,
          styleType: style.type
        }));
        figma.ui.postMessage({ type: 'update-element-count', count: styleElements.length, elements: styleElements.map(element => ({ ...element, selected: true })), currentPageCount });
      } catch (error) {
        console.error('Error fetching styles:', error);
      }
      return;
    }

    if (elementType === 'VARIABLE') {
      try {
        const collections = await figma.variables.getLocalVariableCollectionsAsync();
        const variables: Variable[] = [];
        if (collections && collections.length > 0) {
          await Promise.all(collections.map(async collection => {
            await Promise.all(collection.modes.map(async mode => {
              await Promise.all(collection.variableIds.map(async variableId => {
                const variable = await figma.variables.getVariableByIdAsync(variableId);
                if (mode && variable && variable.valuesByMode && variable.valuesByMode[mode.modeId] !== undefined) {
                  let variableValue = variable.valuesByMode[mode.modeId];
                  if (variable.resolvedType === 'COLOR') {
                    if (typeof variableValue === 'object' && 'r' in variableValue && 'g' in variableValue && 'b' in variableValue) {
                      variableValue = convertRGBToHex(variableValue);
                    }
                  } else if (variable.resolvedType === 'BOOLEAN') {
                    variableValue = variableValue ? 'True' : 'False';
                  } else if (variable.resolvedType === 'FLOAT') {
                    variableValue = variableValue.toString();
                  }
                  variables.push({
                    collectionName: collection.name,
                    modeName: mode.name,
                    variableName: variable.name,
                    variableValue: variableValue
                  });
                }
              }));
            }));
          }));
        }
        figma.ui.postMessage({ type: 'update-element-count', count: variables.length, elements: variables.map(variable => ({ ...variable, selected: true })), currentPageCount });
      } catch (error) {
        console.error('Error fetching variable collections:', error);
      }
      return;
    }

    if (objectScope === 'current-page') {
      nodesToProcess = figma.currentPage.findAll();
      currentPageCount = nodesToProcess.length;
    } else if (objectScope === 'all-pages') {

      await new Promise(resolve => setTimeout(resolve, 40));
      figma.ui.postMessage({ type: 'loading', isLoading: true });
      await new Promise(resolve => setTimeout(resolve, 40));

      await figma.loadAllPagesAsync();
      nodesToProcess = [];
      let pageCount = 0;
      for (let i = 0; i < figma.root.children.length; i++) {
        const page = figma.root.children[i];
        if (page.type === 'PAGE') {
          pageCount = pageCount + 1;
      }}
      for (let i = 0; i < figma.root.children.length; i++) {
        const page = figma.root.children[i];
        if (page.type === 'PAGE') {
          const pageNodes = page.findAll();
          if (page.id === figma.currentPage.id) {
        currentPageCount = pageNodes.length;
          }
          nodesToProcess = nodesToProcess.concat(pageNodes);
        }
        await new Promise(resolve => setTimeout(resolve, 40));
        figma.ui.postMessage({ type: 'loading', isLoading: true, count: i+1, currentPageCount: pageCount, nodesToProcess: nodesToProcess.length });
        await new Promise(resolve => setTimeout(resolve, 40));
      }
    } else if (objectScope === 'current-selection') {
      if (figma.currentPage.selection.length === 0) {
        figma.notify('Error: No selection found!');
        figma.ui.postMessage({ type: 'loading', isLoading: false });
        return;
      }
      nodesToProcess = figma.currentPage.selection.flatMap(node => getNodeAndAllChildren(node));
      currentPageCount = nodesToProcess.length;
    }

    const elements = nodesToProcess.filter((node, index) => {
      if (elementType !== 'ANY') {
        if (elementType === 'UNION' || elementType === 'SUBTRACT' || elementType === 'INTERSECT' || elementType === 'EXCLUDE') {
          if (node.type !== 'BOOLEAN_OPERATION' || node.booleanOperation !== elementType) return false;
        } else if (node.type !== elementType) return false;
      }

      if (filters && filters.length > 0) {
        return filters.reduce((acc: any, filter: { key: any; value: any; logic: any; comparison: any; }, index: number) => {
          const { key, value, logic, comparison } = filter;
          let conditionMet = false;

          switch (key) {
            case 'width':
            case 'height':
            case 'x':
            case 'y':
              const numericValue = parseFloat(value);
              const nodeValue = (node as LayoutMixin)[key as keyof LayoutMixin];
              if (typeof nodeValue === 'number') {
                conditionMet = compareValues(nodeValue, numericValue, comparison);
              }
              break;
            case 'layer-name':
              const layerName = node.name || "";
              if (comparison === 'fits-regex') {
                const regex = new RegExp(value);
                conditionMet = regex.test(layerName);
              } else {
                conditionMet = compareStrings(layerName, value, comparison);
              }
              break;
            case 'page-name':
              const pageName = getPageName(node) || "";
              if (comparison === 'fits-regex') {
                const regex = new RegExp(value);
                conditionMet = regex.test(pageName);
              } else {
                conditionMet = compareStrings(pageName, value, comparison);
              }
              break;
            case 'appearance-rounding':
              if ('cornerRadius' in node) {
                const cornerRadiusValue = node.cornerRadius;
                if (typeof cornerRadiusValue === 'number') {
                  const roundingValue = parseFloat(value);
                  conditionMet = compareValues(cornerRadiusValue, roundingValue, comparison);
                }
              }
              break;
            case 'fill':
              if ('fills' in node && Array.isArray(node.fills)) {
                const hexValue = processHexInput(value);
                conditionMet = compareFills(node.fills, hexValue, comparison);
              }
              break;
            case 'stroke':
              if ('strokeWeight' in node) {
                const strokeWeightValue = node.strokeWeight;
                if (typeof strokeWeightValue === 'number') {
                  const strokeValue = parseFloat(value);
                  conditionMet = compareValues(strokeWeightValue, strokeValue, comparison);
                }
              }
              break;
            case 'stroke-color':
              if ('strokes' in node) {
                const hexStrokeValue = processHexInput(value);
                conditionMet = compareStrokes(node.strokes, hexStrokeValue, comparison);
              }
              break;
            case 'appearance-opacity':
              const opacityValue = parseFloat(value) / 100;
              if ('opacity' in node) {
                conditionMet = compareValues(node.opacity, opacityValue, comparison, 0.01);
              }
              break;
            case 'effect-drop_shadow':
            case 'effect-inner_shadow':
            case 'effect-layer_blur':
            case 'effect-background_blur':
              if ('effects' in node && Array.isArray(node.effects)) {
                const effectType = key.split('-')[1].toUpperCase();
                const hasEffect = node.effects.some(effect => effect.type === effectType);
                conditionMet = comparison === 'is-applied' ? hasEffect : !hasEffect;
              }
              break;
            case 'effect-drop_shadow-positionx':
              if ('effects' in node && Array.isArray(node.effects)) {
                const effectType = 'DROP_SHADOW';
                const effect = node.effects.find(effect => effect.type === effectType);
                if (effect) {
                  const numericValue = parseFloat(value);
                  conditionMet = compareValues(effect.offset.x, numericValue, comparison);
                }
              }
              break;
            case 'effect-drop_shadow-positiony':
              if ('effects' in node && Array.isArray(node.effects)) {
                const effectType = 'DROP_SHADOW';
                const effect = node.effects.find(effect => effect.type === effectType);
                if (effect) {
                  const numericValue = parseFloat(value);
                  conditionMet = compareValues(effect.offset.y, numericValue, comparison);
                }
              }
              break;
            case 'effect-drop_shadow-blur':
              if ('effects' in node && Array.isArray(node.effects)) {
                const effectType = 'DROP_SHADOW';
                const effect = node.effects.find(effect => effect.type === effectType);
                if (effect) {
                  const numericValue = parseFloat(value);
                  conditionMet = compareValues(effect.radius, numericValue, comparison);
                }
              }
              break;
            case 'effect-drop_shadow-spread':
              if ('effects' in node && Array.isArray(node.effects)) {
                const effectType = 'DROP_SHADOW';
                const effect = node.effects.find(effect => effect.type === effectType);
                if (effect) {
                  const numericValue = parseFloat(value);
                  conditionMet = compareValues(effect.spread, numericValue, comparison);
                }
              }
              break;
            case 'effect-drop_shadow-color':
              if ('effects' in node && Array.isArray(node.effects)) {
                const effectType = 'DROP_SHADOW';
                const effect = node.effects.find(effect => effect.type === effectType);
                if (effect) {
                  const hexValue = processHexInput(value);
                  conditionMet = compareColors(effect.color, hexValue, comparison);
                }
              }
              break;
            case 'effect-drop_shadow-blendmode':
              if ('effects' in node && Array.isArray(node.effects)) {
                const effectType = 'DROP_SHADOW';
                const effect = node.effects.find(effect => effect.type === effectType);
                if (effect) {
                  conditionMet = compareStrings(effect.blendMode, value, comparison);
                }
              }
              break;
            case 'effect-inner_shadow-positionx':
              if ('effects' in node && Array.isArray(node.effects)) {
                const effectType = 'INNER_SHADOW';
                const effect = node.effects.find(effect => effect.type === effectType);
                if (effect) {
                  const numericValue = parseFloat(value);
                  conditionMet = compareValues(effect.offset.x, numericValue, comparison);
                }
              }
              break;
            case 'effect-inner_shadow-positiony':
              if ('effects' in node && Array.isArray(node.effects)) {
                const effectType = 'INNER_SHADOW';
                const effect = node.effects.find(effect => effect.type === effectType);
                if (effect) {
                  const numericValue = parseFloat(value);
                  conditionMet = compareValues(effect.offset.y, numericValue, comparison);
                }
              }
              break;
            case 'effect-inner_shadow-blur':
              if ('effects' in node && Array.isArray(node.effects)) {
                const effectType = 'INNER_SHADOW';
                const effect = node.effects.find(effect => effect.type === effectType);
                if (effect) {
                  const numericValue = parseFloat(value);
                  conditionMet = compareValues(effect.radius, numericValue, comparison);
                }
              }
              break;
            case 'effect-inner_shadow-spread':
              if ('effects' in node && Array.isArray(node.effects)) {
                const effectType = 'INNER_SHADOW';
                const effect = node.effects.find(effect => effect.type === effectType);
                if (effect) {
                  const numericValue = parseFloat(value);
                  conditionMet = compareValues(effect.spread, numericValue, comparison);
                }
              }
              break;
            case 'effect-inner_shadow-color':
              if ('effects' in node && Array.isArray(node.effects)) {
                const effectType = 'INNER_SHADOW';
                const effect = node.effects.find(effect => effect.type === effectType);
                if (effect) {
                  const hexValue = processHexInput(value);
                  conditionMet = compareColors(effect.color, hexValue, comparison);
                }
              }
              break;
            case 'effect-inner_shadow-blendmode':
              if ('effects' in node && Array.isArray(node.effects)) {
                const effectType = 'INNER_SHADOW';
                const effect = node.effects.find(effect => effect.type === effectType);
                if (effect) {
                  conditionMet = compareStrings(effect.blendMode, value, comparison);
                }
              }
              break;
            case 'visibility':
              if ('visible' in node) {
                const isVisible = node.visible;
                conditionMet = comparison === 'is-visible' ? isVisible : !isVisible;
              }
              break;
            case 'font-name':
              if ('fontName' in node) {
                const fontName = (node.fontName as FontName).family;
                conditionMet = compareStrings(fontName, value, comparison);
              }
              break;
            case 'font-size':
              if ('fontSize' in node) {
                const fontSizeValue = parseFloat(value);
                if (typeof node.fontSize === 'number') {
                  conditionMet = compareValues(node.fontSize, fontSizeValue, comparison);
                }
              }
              break;
            case 'line-height':
              if ('lineHeight' in node) {
                if (value.toLowerCase() === 'auto') {
                  conditionMet = typeof node.lineHeight === 'object' && node.lineHeight.unit === 'AUTO';
                } else {
                  const lineHeightValue = parseFloat(value);
                  if (typeof node.lineHeight === 'object' && 'value' in node.lineHeight) {
                    conditionMet = compareValues(node.lineHeight.value, lineHeightValue, comparison);
                  }
                }
              }
              break;
            case 'letter-spacing':
              if ('letterSpacing' in node) {
                const letterSpacingValue = parseFloat(value);
                if (typeof node.letterSpacing === 'object' && node.letterSpacing.unit === 'PERCENT') {
                  const nodeLetterSpacingValue = node.letterSpacing.value;
                  conditionMet = compareValues(nodeLetterSpacingValue, letterSpacingValue, comparison);
                }
              }
              break;
            case 'font-weight':
              if ('fontWeight' in node) {
                const fontWeight = node.fontWeight;
                conditionMet = compareStrings(fontWeight.toString(), value, comparison);
              }
              break;
            case 'appearance-blendmode':
              if ('blendMode' in node) {
                const blendMode = node.blendMode;
                conditionMet = compareStrings(blendMode, value, comparison);
              }
              break;
            case 'rotation':
              if ('rotation' in node) {
                const rotationValue = parseFloat(value);
                conditionMet = compareValues(node.rotation, rotationValue, comparison);
              }
              break;
            case 'number-of-children':
              if ('children' in node) {
                const childrenCount = node.children.length;
                const numericValue = parseFloat(value);
                conditionMet = compareValues(childrenCount, numericValue, comparison);
              }
              break;
            case 'corner-radius-top-left':
              if ('cornerRadius' in node) {
                const cornerRadiusValue = parseFloat(value);
                if ('topLeftRadius' in node) {
                  conditionMet = compareValues(node.topLeftRadius, cornerRadiusValue, comparison);
                }
              }
              break;
            case 'corner-radius-top-right':
              if ('cornerRadius' in node) {
                const cornerRadiusValue = parseFloat(value);
                if ('topRightRadius' in node) {
                  conditionMet = compareValues(node.topRightRadius, cornerRadiusValue, comparison);
                }
              }
              break;
            case 'corner-radius-bottom-left':
              if ('cornerRadius' in node) {
                const cornerRadiusValue = parseFloat(value);
                if ('bottomLeftRadius' in node) {
                  conditionMet = compareValues(node.bottomLeftRadius, cornerRadiusValue, comparison);
                }
              }
              break;
            case 'corner-radius-bottom-right':
              if ('cornerRadius' in node) {
                const cornerRadiusValue = parseFloat(value);
                if ('bottomRightRadius' in node) {
                  conditionMet = compareValues(node.bottomRightRadius, cornerRadiusValue, comparison);
                }
              }
              break;
            case 'fills-blendmode':
              if ('fills' in node && Array.isArray(node.fills)) {
                conditionMet = node.fills.some(fill => compareStrings(fill.blendMode, value, comparison));
              }
              break;
            case 'fills-opacity':
              if ('fills' in node && Array.isArray(node.fills)) {
                const opacityValue = parseFloat(value) / 100;
                conditionMet = node.fills.some(fill => compareValues(fill.opacity, opacityValue, comparison, 0.01));
              }
              break;
            case 'fills-visibility':
              if ('fills' in node && Array.isArray(node.fills)) {
                conditionMet = node.fills.some(fill => {
                  const isVisible = fill.visible !== false;
                  return comparison === 'is-visible' ? isVisible : !isVisible;
                });
              }
              break;
            case 'strokes-blendmode':
              if ('strokes' in node && Array.isArray(node.strokes)) {
                conditionMet = node.strokes.some(stroke => compareStrings(stroke.blendMode, value, comparison));
              }
              break;
            case 'strokes-opacity':
              if ('strokes' in node && Array.isArray(node.strokes)) {
                const opacityValue = parseFloat(value) / 100;
                conditionMet = node.strokes.some(stroke => compareValues(stroke.opacity, opacityValue, comparison, 0.01));
              }
              break;
            case 'strokes-visibility':
              if ('strokes' in node && Array.isArray(node.strokes)) {
                conditionMet = node.strokes.some(stroke => stroke.visible === (value === 'true'));
              }
              break;
            case 'strokes-type':
              if ('strokes' in node && Array.isArray(node.strokes)) {
                const hexValue = processHexInput(value);
                conditionMet = compareFills(node.strokes, hexValue, comparison);
              }
              break;
            case 'strokes-align':
              if ('strokes' in node && Array.isArray(node.strokes) && node.strokes.length > 0) {
                if ('strokeAlign' in node) {
                  conditionMet = compareStrings(node.strokeAlign, value, comparison);
                }
              }
              break;
            case 'autolayout':
              if ('layoutMode' in node) {
                conditionMet = comparison === 'is-applied' ? node.layoutMode !== 'NONE' : node.layoutMode === 'NONE';
              }
              break;
            case 'autolayout-position':
              if ('primaryAxisAlignItems' in node) {
                conditionMet = compareStrings(node.primaryAxisAlignItems, value, comparison);
              }
              break;
            case 'autolayout-direction':
              if ('layoutMode' in node) {
                const direction = value.toUpperCase();
                conditionMet = compareStrings(node.layoutMode, direction, comparison);
              }
              break;
            case 'autolayout-item-spacing':
              if ('itemSpacing' in node) {
                const itemSpacingValue = parseFloat(value);
                conditionMet = compareValues(node.itemSpacing, itemSpacingValue, comparison);
              }
              break;
            case 'autolayout-padding-top':
              if ('layoutMode' in node) {
                const layoutValue = parseFloat(value);
                conditionMet = compareValues(node.paddingTop, layoutValue, comparison);
              }
              break;
            case 'autolayout-padding-bottom':
              if ('layoutMode' in node) {
                const layoutValue = parseFloat(value);
                conditionMet = compareValues(node.paddingBottom, layoutValue, comparison);
              }
              break;
            case 'autolayout-padding-left':
              if ('layoutMode' in node) {
                const layoutValue = parseFloat(value);
                conditionMet = compareValues(node.paddingLeft, layoutValue, comparison);
              }
              break;
            case 'autolayout-padding-right':
              if ('layoutMode' in node) {
                const layoutValue = parseFloat(value);
                conditionMet = compareValues(node.paddingRight, layoutValue, comparison);
              }
              break;
            case 'text-horizontal-align':
              if ('textAlignHorizontal' in node) {
                conditionMet = compareStrings(node.textAlignHorizontal, value, comparison);
              }
              break;
            case 'text-vertical-align':
              if ('textAlignVertical' in node) {
                conditionMet = compareStrings(node.textAlignVertical, value, comparison);
              }
              break;
            case 'text-decoration':
              if ('textDecoration' in node) {
                if (typeof node.textDecoration === 'string') {
                  conditionMet = compareStrings(node.textDecoration, value, comparison);
                }
              }
              break;
            case 'paragraph-indent':
              if ('paragraphIndent' in node) {
                const paragraphIndentValue = parseFloat(value);
                conditionMet = compareValues(node.paragraphIndent, paragraphIndentValue, comparison);
              }
              break;
            case 'paragraph-spacing':
              if ('paragraphSpacing' in node) {
                const paragraphSpacingValue = parseFloat(value);
                conditionMet = compareValues(node.paragraphSpacing, paragraphSpacingValue, comparison);
              }
              break;
            case 'number-of-points':
              if (node.type === 'VECTOR') {
                const pointsValue = parseFloat(value);
                const vectorNode = node as VectorNode;
                const numPoints = vectorNode.vectorPaths.reduce((acc, path) => acc + path.data.split(' ').length / 3, 0);
                conditionMet = compareValues(numPoints, pointsValue, comparison);
              }
              break;
            case 'export-setting':
              if ('exportSettings' in node) {
                const hasExportSettings = node.exportSettings && node.exportSettings.length > 0;
                conditionMet = comparison === 'is-applied' ? hasExportSettings : !hasExportSettings;
              }
              break;
            case 'overriden-properties':
              if (node.type === 'INSTANCE') {
                const hasOverrides = node.overrides.length > 0;
                if (comparison === 'yes') {
                  conditionMet = hasOverrides;
                } else {
                  conditionMet = !hasOverrides;
                }
              }
              break;
            case 'is-locked':
              if ('locked' in node) {
                const isLocked = node.locked;
                conditionMet = (comparison === 'yes') ? isLocked : !isLocked;
              }
              break;
            case 'is-mask':
              if ('isMask' in node) {
                const isMask = node.isMask;
                conditionMet = (comparison === 'yes') ? isMask : !isMask;
              }
              break;
            case 'interaction':
              if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
                if (node.reactions && node.reactions.length > 0) {
                  const hasInteraction = node.reactions.some(reaction => reaction.action !== null && reaction.action !== undefined);
                  conditionMet = comparison === 'is-applied' ? hasInteraction : !hasInteraction;
                } else {
                  if (comparison === 'is-applied') {
                    conditionMet = false;
                  }
                  if (comparison === 'is-not-applied') {
                    conditionMet = true;
                  }
                }
              } else { conditionMet = false; }
              break;
            case 'flow-starting-point':
              if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
                const isStartingPoint = (objectScope === 'all-pages' ? figma.root.children : [figma.currentPage]).some(page => {
                  if (page.type === 'PAGE') {
                    return page.flowStartingPoints.some(flow => flow.nodeId === node.id);
                  }
                  return false;
                });
                conditionMet = comparison === 'is-applied' ? isStartingPoint : !isStartingPoint;
              }
              break;
            case 'interaction-trigger':
              if ('reactions' in node) {
                const hasTrigger = node.reactions.some(reaction => {
                  if (reaction.trigger) {
                    if (comparison === 'equals') {
                      return reaction.trigger.type === value;
                    } else if (comparison === 'does-not-equal') {
                      return reaction.trigger.type !== value;
                    }
                    return false;
                  }
                });
                conditionMet = hasTrigger;
              }
              break;
            case 'interaction-action':
              if ('reactions' in node) {
                const hasAction = node.reactions.some(reaction => {
                  if (reaction.action) {
                    if (comparison === 'equals') {
                      if (reaction.action.type === "NODE") {
                        var navigation_node = reaction.action.navigation;
                        return navigation_node === value;
                      } else if (reaction.action.type === "UPDATE_MEDIA_RUNTIME") {
                        return reaction.action.mediaAction === value;
                      }
                      else {
                        return reaction.action.type === value;
                      }
                    } else if (comparison === 'does-not-equal') {
                      if (reaction.action.type == "NODE") {
                        var navigation_node = reaction.action.navigation;
                        return navigation_node !== value;
                      } else if (reaction.action.type === "UPDATE_MEDIA_RUNTIME") {
                        return reaction.action.mediaAction !== value;
                      }
                      else {
                        return reaction.action.type !== value;
                      }
                    }
                    return false;
                  }
                });
                conditionMet = hasAction;
              }
              break;
            case 'nested-level':
              const nestedLevelValue = parseInt(value);
              const nodeNestedLevel = getNodeNestedLevel(node);
              conditionMet = compareValues(nodeNestedLevel, nestedLevelValue, comparison);
              break;
            default:
              break;
          }

          //if (index === nodesToProcess.length - 1) {
          //  figma.ui.postMessage({ type: 'loading', isLoading: false });
          //index = 0;
          //}

          if (index === 0) return conditionMet;
          return logic === 'AND' ? acc && conditionMet : acc || conditionMet;
        }, true);
      }

      return true;
    });

    figma.ui.postMessage({ type: 'loading', isLoading: false });

    figma.ui.postMessage({ type: 'update-element-count', count: elements.length, elements: elements.map(element => ({ id: element.id, name: element.name, pageName: getPageName(element), selected: true })), currentPageCount });

    const selectedElements = msg.selectedElements || [];

    const filteredElements = elements.filter(function(node) {
      return selectedElements.includes(node.id);
    });

    if (action === 'select') {
      if (objectScope === 'all-pages') {
        const elementsOnCurrentPage: SceneNode[] = filteredElements.filter((node: SceneNode) => getPageId(node) === figma.currentPage.id);
        figma.currentPage.selection = elementsOnCurrentPage;
      } else {
      figma.currentPage.selection = filteredElements;
    }
    } else if (action === 'delete') {
      elements.forEach(node => {
        if (filteredElements.includes(node)) {
          node.remove();
        }
      });
      figma.ui.postMessage({ type: 'update-results'}); // Refresh results list
    } else if (action === 'rename') {
      elements.forEach((node, index) => {
        if (filteredElements.includes(node)) {
          const alphabet = String.fromCharCode(97 + (index % 26)); // cycles from a-z
          const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
          const newNameWithVariables = newName
            .replace('{id}', (index + 1).toString())
            .replace('{name}', node.name)
            .replace('{page}', getPageName(node))
            .replace('{date}', currentDate)
            .replace('{alphabet}', alphabet);
          if (replaceText) {
            const regex = new RegExp(replaceText, 'g');
            node.name = node.name.replace(regex, newNameWithVariables);
          } else {
            node.name = newNameWithVariables;
          }
        }
      });
      figma.ui.postMessage({ type: 'update-results'}); // Refresh results list
    } else if (action === 'duplicate') {
      const duplicates = elements.filter((node: SceneNode) => filteredElements.includes(node)).map(node => {
        const clone = node.clone();
        figma.currentPage.appendChild(clone);
        return clone;
      });
      figma.currentPage.selection = duplicates;
      figma.viewport.scrollAndZoomIntoView(duplicates);
    } else if (action === 'export') {
      const elementsToExport = elements.filter(node => filteredElements.some(filteredNode => filteredNode.id === node.id));
      if (elementsToExport.length > 1) {
        const zip = new JSZip();
        for (const node of elementsToExport) {
          try {
            let exportSettings;
            if (node.exportSettings?.length) {
              exportSettings = node.exportSettings;
            } else {
              exportSettings = [{
                format: 'PNG',
                constraint: { type: 'SCALE', value: 2 },
                suffix: ''
              }];
            }
            if (exportFormat !== 'default') {
              exportSettings = exportSettings.map(setting => ({ ...setting, format: exportFormat }));
            }
            if (exportScale !== 'default') {
              exportSettings = exportSettings.map(setting => ({ ...setting, constraint: { type: 'SCALE', value: parseInt(exportScale) } }));
            }
            if (exportSuffix !== 'default') {
              exportSettings = exportSettings.map(setting => ({ ...setting, suffix: exportSuffix }));
            }
            for (const settings of exportSettings) {
              const image = await node.exportAsync(settings as ExportSettingsImage);
              zip.file(`${node.name}${settings.suffix || ''}.${settings.format.toLowerCase()}`, image);
            }
          } catch (error) {
            console.error('Export failed for node:', node, error);
          }
        }
        const base64 = await zip.generateAsync({ type: 'base64' });
        const url = `data:application/zip;base64,${base64}`;
        figma.ui.postMessage({ type: 'download-file', url, name: 'export.zip' });
      } else if (elementsToExport.length === 1) {
        const node = elementsToExport[0];
        try {
          let exportSettings;
          if (node.exportSettings?.length) {
            exportSettings = node.exportSettings;
          } else {
            exportSettings = [{
              format: 'PNG',
              constraint: { type: 'SCALE', value: 2 },
              suffix: ''
            }];
          }
          if (exportFormat !== 'default') {
            exportSettings = exportSettings.map(setting => ({ ...setting, format: exportFormat }));
          }
          if (exportScale !== 'default') {
            exportSettings = exportSettings.map(setting => ({ ...setting, constraint: { type: 'SCALE', value: parseInt(exportScale) } }));
          }
          if (exportSuffix !== 'default') {
            exportSettings = exportSettings.map(setting => ({ ...setting, suffix: exportSuffix }));
          }
          for (const settings of exportSettings) {
            const image = await node.exportAsync(settings as ExportSettingsImage);
            const base64Image = figma.base64Encode(image);
            const url = `data:image/${settings.format.toLowerCase()};base64,${base64Image}`;
            figma.ui.postMessage({ type: 'download-file', url, name: `${node.name}${settings.suffix || ''}.${settings.format.toLowerCase()}` });
          }
        } catch (error) {
          console.error('Export failed for node:', node, error);
        }
      }
    }
  }

  if (msg.type === 'select-element') {
    var { element } = msg;
    if (element) {
      figma.getNodeByIdAsync(element.id).then(node => {
        while (node && node.type !== 'PAGE') {
          node = node.parent;
        }
        if (node) {
          figma.setCurrentPageAsync(node);
        }
      }
      );
      figma.currentPage.selection = [element];
      figma.viewport.scrollAndZoomIntoView([element]);
    }
  }

  if (msg.type === 'resize-window') {
    figma.ui.resize(1100, msg.height);
  }

  if (msg.type === 'close-plugin') {
    figma.closePlugin();
  }
};

function compareValues(nodeValue: number, value: number, comparison: string, tolerance = 0) {
  switch (comparison) {
    case 'equals': return Math.abs(nodeValue - value) <= tolerance;
    case 'is-larger-than': return nodeValue > value;
    case 'is-smaller-than': return nodeValue < value;
    case 'does-not-equal': return Math.abs(nodeValue - value) > tolerance;
    default: return false;
  }
}

function compareStrings(nodeValue: string, value: string, comparison: string) {
  switch (comparison) {
    case 'equals': return nodeValue === value;
    case 'does-not-equal': return nodeValue !== value;
    case 'contains': return nodeValue.includes(value);
    case 'does-not-contain': return !nodeValue.includes(value);
    default: return false;
  }
}

function compareFills(paints: readonly Paint[], hexValue: string, comparison: string) {
  switch (comparison) {
    case 'is-of-color':
      return paints.some(paint => paint.type === 'SOLID' && convertRGBToHex(paint.color) === hexValue);
    case 'is-gradient':
      return paints.some(paint => paint.type === 'GRADIENT_LINEAR' || paint.type === 'GRADIENT_RADIAL' || paint.type === 'GRADIENT_ANGULAR' || paint.type === 'GRADIENT_DIAMOND');
    case 'is-image':
      return paints.some(paint => paint.type === 'IMAGE');
    case 'is-video':
      return paints.some(paint => paint.type === 'VIDEO');
    default: return false;
  }
}

function compareStrokes(paints: readonly Paint[], hexValue: string, comparison: string) {
  switch (comparison) {
    case 'equals':
      return paints.some(paint => paint.type === 'SOLID' && convertRGBToHex(paint.color) === hexValue);
    case 'does-not-equal':
      return !paints.some(paint => paint.type === 'SOLID' && convertRGBToHex(paint.color) === hexValue);
    default: return false;
  }
}

function processHexInput(value: string): string {
  return value.startsWith('#') ? value.slice(1).toUpperCase() : value.toUpperCase();
}

function convertRGBToHex(color: RGB): string {
  return (
    Math.round(color.r * 255).toString(16).padStart(2, '0') +
    Math.round(color.g * 255).toString(16).padStart(2, '0') +
    Math.round(color.b * 255).toString(16).padStart(2, '0')
  ).toUpperCase();
}

function compareColors(color: RGBA, hexValue: string, comparison: string) {
  const colorHex = convertRGBToHex({ r: color.r, g: color.g, b: color.b });
  switch (comparison) {
    case 'equals': return colorHex === hexValue;
    case 'does-not-equal': return colorHex !== hexValue;
    default: return false;
  }
}

function getPageName(node: SceneNode): string {
  let currentNode: BaseNode | null = node;
  while (currentNode && currentNode.type !== 'PAGE') {
    currentNode = currentNode.parent;
  }
  return currentNode ? currentNode.name : '';
}

function getPageId(node: SceneNode): string {
  let currentNode: BaseNode | null = node;
  while (currentNode && currentNode.type !== 'PAGE') {
    currentNode = currentNode.parent;
  }
  return currentNode ? currentNode.id : '';
}

function getNodeNestedLevel(node: SceneNode): number {
  let level = 0;
  let currentNode: BaseNode | null = node;
  while (currentNode && currentNode.parent && currentNode.parent.type !== 'PAGE') {
    level++;
    currentNode = currentNode.parent;
  }
  return level;
}

function getNodeAndAllChildren(node: SceneNode): SceneNode[] {
  let nodes: SceneNode[] = [];
  nodes.push(node);
  if ('children' in node) {
    node.children.forEach(child => {
      nodes = nodes.concat(getNodeAndAllChildren(child));
    });
  }
  return nodes;
}