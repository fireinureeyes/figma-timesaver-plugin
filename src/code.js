"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
figma.showUI(__html__, { width: 1000, height: 310 });
figma.ui.onmessage = (msg) => __awaiter(void 0, void 0, void 0, function* () {
    if (msg.type === 'initialize-count') {
        const nodesToProcess = Array.from(figma.currentPage.findAll());
        figma.ui.postMessage({ type: 'update-element-count', count: nodesToProcess.length });
    }
    if (msg.type === 'filter-elements') {
        const { objectScope, elementType, filters, action, newName } = msg;
        let nodesToProcess = [];
        if (objectScope === 'current-page') {
            nodesToProcess = Array.from(figma.currentPage.findAll());
        }
        else if (objectScope === 'all-pages') {
            yield figma.loadAllPagesAsync();
            nodesToProcess = figma.root.children.reduce((acc, page) => {
                if (page.type === 'PAGE') {
                    acc.push(...page.findAll());
                }
                return acc;
            }, []);
        }
        else if (objectScope === 'current-selection') {
            if (figma.currentPage.selection.length === 0) {
                figma.notify('Error: No selection found!');
                return;
            }
            nodesToProcess = Array.from(figma.currentPage.selection);
        }
        const elements = nodesToProcess.filter(node => {
            if (elementType !== 'ANY') {
                if (elementType === 'UNION' || elementType === 'SUBTRACT' || elementType === 'INTERSECT' || elementType === 'EXCLUDE') {
                    if (node.type !== 'BOOLEAN_OPERATION' || node.booleanOperation !== elementType)
                        return false;
                }
                else if (node.type !== elementType)
                    return false;
            }
            if (filters && filters.length > 0) {
                return filters.reduce((acc, filter, index) => {
                    const { key, value, logic, comparison } = filter;
                    let conditionMet = false;
                    switch (key) {
                        case 'width':
                        case 'height':
                        case 'x':
                        case 'y':
                            const numericValue = parseFloat(value);
                            const nodeValue = node[key];
                            if (typeof nodeValue === 'number') {
                                conditionMet = compareValues(nodeValue, numericValue, comparison);
                            }
                            break;
                        case 'layer-name':
                            const layerName = node.name || "";
                            if (comparison === 'fits-regex') {
                                const regex = new RegExp(value);
                                conditionMet = regex.test(layerName);
                            }
                            else {
                                conditionMet = compareStrings(layerName, value, comparison);
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
                        case 'visibility':
                            if ('visible' in node) {
                                const isVisible = node.visible;
                                conditionMet = comparison === 'is-visible' ? isVisible : !isVisible;
                            }
                            break;
                        case 'font-name':
                            if ('fontName' in node) {
                                const fontName = node.fontName.family;
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
                                }
                                else {
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
                            break;
                        default:
                            break;
                    }
                    if (index === 0)
                        return conditionMet;
                    return logic === 'AND' ? acc && conditionMet : acc || conditionMet;
                }, true);
            }
            return true;
        });
        figma.ui.postMessage({ type: 'update-element-count', count: elements.length, elements: elements.map(element => { var _a; return ({ id: element.id, name: element.name, pageName: (_a = element.parent) === null || _a === void 0 ? void 0 : _a.name }); }) });
        if (action === 'select') {
            figma.currentPage.selection = elements;
        }
        else if (action === 'delete') {
            elements.forEach(node => node.remove());
        }
        else if (action === 'rename') {
            elements.forEach((node, index) => {
                node.name = `${newName || 'Renamed'} ${index + 1}`;
            });
        }
        else if (action === 'export') {
            for (const node of elements) {
                try {
                    const newExportSettings = {
                        format: 'PNG',
                        constraint: { type: 'SCALE', value: 2 }
                    };
                    if (node.exportSettings[0]) {
                        const image = yield node.exportAsync(node.exportSettings[0]);
                        figma.ui.postMessage({ type: 'export-image', image, name: node.name, settings: node.exportSettings[0] });
                    }
                    else {
                        const image = yield node.exportAsync(newExportSettings);
                        figma.ui.postMessage({ type: 'export-image', image, name: node.name, settings: newExportSettings });
                    }
                    //const zip = new JSZip();
                    //zip.file(`${1}.png`, node.exportAsync(newExportSettings), { base64: true });
                }
                catch (error) {
                    console.error('Export failed for node:', node, error);
                }
            }
        }
    }
    if (msg.type === 'select-element') {
        const { element } = msg;
        if (element) {
            figma.currentPage.selection = [element];
            figma.viewport.scrollAndZoomIntoView([element]);
        }
    }
    if (msg.type === 'resize-window') {
        figma.ui.resize(1000, msg.height);
    }
    if (msg.type === 'close-plugin') {
        figma.closePlugin();
    }
});
function compareValues(nodeValue, value, comparison, tolerance = 0) {
    switch (comparison) {
        case 'equals': return Math.abs(nodeValue - value) <= tolerance;
        case 'is-larger-than': return nodeValue > value;
        case 'is-smaller-than': return nodeValue < value;
        case 'does-not-equal': return Math.abs(nodeValue - value) > tolerance;
        default: return false;
    }
}
function compareStrings(nodeValue, value, comparison) {
    switch (comparison) {
        case 'equals': return nodeValue === value;
        case 'does-not-equal': return nodeValue !== value;
        case 'contains': return nodeValue.includes(value);
        case 'does-not-contain': return !nodeValue.includes(value);
        default: return false;
    }
}
function compareFills(paints, hexValue, comparison) {
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
function compareStrokes(paints, hexValue, comparison) {
    switch (comparison) {
        case 'equals':
            return paints.some(paint => paint.type === 'SOLID' && convertRGBToHex(paint.color) === hexValue);
        case 'does-not-equal':
            return !paints.some(paint => paint.type === 'SOLID' && convertRGBToHex(paint.color) === hexValue);
        default: return false;
    }
}
function processHexInput(value) {
    return value.startsWith('#') ? value.slice(1).toUpperCase() : value.toUpperCase();
}
function convertRGBToHex(color) {
    return (Math.round(color.r * 255).toString(16).padStart(2, '0') +
        Math.round(color.g * 255).toString(16).padStart(2, '0') +
        Math.round(color.b * 255).toString(16).padStart(2, '0')).toUpperCase();
}
