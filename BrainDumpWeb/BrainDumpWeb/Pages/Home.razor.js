window.updateDotnetRef = function(ref) {
    window.latestDotNetRef = ref;
}

window.isTextMovedIntoDiv = function () {
    return !!document.getElementById('rich-text-container');
}

window.convertRichTextToImage = async function () {
    const container = document.getElementById('rich-text-container');
    if (!container) return '';

    window.textRectangles = getTextRectsRelativeToContainer(container);

    try {
        const canvas = await html2canvas(container, {
            scale: 1,
            useCORS: true,
            backgroundColor: '#ffffff'
        });
        return canvas.toDataURL('image/png');
    } catch (err) {
        console.error('html2canvas error:', err);
        return '';
    }
};

window.initTearableCanvas = function (imageDataUrl) {
    const canvasEl = document.getElementById('tear-canvas');
    if (!canvasEl) return;

    const textEl = document.getElementById('rich-text-container');
    if (!textEl) return;

    if (window.tearCanvas) {
        window.tearCanvas.dispose();
    }

    const canvas = new fabric.Canvas('tear-canvas');
    window.tearCanvas = canvas;

    // Disable built‑in object selection
    canvas.selection = false;
    canvas.defaultCursor = 'default';

    canvas.setWidth(textEl.offsetWidth);
    canvas.setHeight(textEl.offsetHeight);

    fabric.Image.fromURL(imageDataUrl, function (img) {
        img.set({
            left: 0,
            top: 0,
            selectable: false,
            evented: false,
            hasControls: false,
            hasBorders: false
        });

        canvas.add(img);
        canvas.renderAll();

        // Attach the tearing logic (no grid lines are drawn initially)
        setupTearing(canvas, img);
    });
};

// ---------- Tearing logic ----------
function setupTearing(canvas, originalImage) {
    const squareSize = 100;
    const width = canvas.width;
    const height = canvas.height;
    const cols = Math.floor(width / squareSize);
    const rows = Math.floor(height / squareSize);

    // Store cell info (bounds + torn flag)
    const cells = [];
    const cellsAoa = [];
    for (let row = 0; row < rows; row++) {
        const isLastRow = row == rows - 1;

        cellsAoa.push([]);
        for (let col = 0; col < cols; col++) {
            const isLastCol = col == cols - 1;

            const left = col * squareSize;
            const top = row * squareSize;
            const right = !isLastCol ? Math.min(left + squareSize, width) : width;
            const bottom = !isLastRow ? Math.min(top + squareSize, height) : height;
            const cellWidth = right - left;
            const cellHeight = bottom - top;
            if (cellWidth <= 0 || cellHeight <= 0) continue;

            const cell = {
                left, top,
                width: cellWidth,
                height: cellHeight,
                torn: false,
                hasText: isCellWithText(left, top, width, height, window.textRectangles),
                row: row,
                column: col
            };

            cells.push(cell);

            cellsAoa[row].push(cell);
        }
    }

    let dragState = null; // { image, offsetX, offsetY }

    canvas.on('mouse:down', (options) => {
        if (dragState) return;

        const pointer = canvas.getPointer(options.e);
        const x = pointer.x;
        const y = pointer.y;

        for (let cell of cells) {
            if (x >= cell.left && x < cell.left + cell.width &&
                y >= cell.top && y < cell.top + cell.height) {

                if (!cell.torn) {
                    const neighbour = {
                        top: (cellsAoa[cell.row - 1] || [])[cell.column],
                        right: cellsAoa[cell.row][cell.column + 1],
                        bottom: (cellsAoa[cell.row + 1] || [])[cell.column],
                        left: cellsAoa[cell.row][cell.column - 1],
                    };

                    startTear(canvas, originalImage, cell, pointer, neighbour);
                }
                break;
            }
        }
    });

    canvas.on('mouse:move', (options) => {
        if (!window.dragState) return;
        const pointer = canvas.getPointer(options.e);
        window.dragState.image.set({
            left: pointer.x - window.dragState.offsetX,
            top: pointer.y - window.dragState.offsetY
        });
        canvas.renderAll();
    });

    canvas.on('mouse:up', () => {
        if (!window.dragState) return;

        const img = window.dragState.image;

        window.dragState = null;

        img.animate('opacity', 0, {
            duration: 500,
            onChange: () => canvas.renderAll(),
            onComplete: () => {
                canvas.remove(img);

                const isTextTorn = !cells.some(c => !c.torn && c.hasText);
                if (isTextTorn) {
                    window.latestDotNetRef
                        .invokeMethodAsync("NotifyTearingComplete")
                        .catch(err => {
                            console.error('An unexpected error has ocurred: ', err);
                        });
                }
            }
        });
    });
}

function isCellWithText(cellLeft, cellTop, cellWidth, cellHeight, textRects) {
    const cellRight = cellLeft + cellWidth;
    const cellBottom = cellTop + cellHeight;

    for (const rect of textRects) {
        // rect has left, top, right, bottom properties
        if (cellLeft < rect.right &&
            cellRight > rect.left &&
            cellTop < rect.bottom &&
            cellBottom > rect.top) {
            return true; // Overlap found – cell contains text
        }
    }
    return false; // No text in this cell
}

function startTear(canvas, originalImage, cell, pointer, neighbour) {
    // Mark cell as torn
    cell.torn = true;

    // 1. Generate jittered polygon points (relative to cell)
    cell.points = getJitteredPointsRelative(cell.width, cell.height, 10, neighbour);
    const relPoints = cell.points.all;

    // 2. Create a gray filled polygon where the piece was (absolute coords)
    const absPath = pointsToSVGPath(relPoints, cell.left, cell.top);
    const grayPatch = new fabric.Path(absPath, {
        fill: 'lightgray',
        strokeWidth: 0,
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false
    });
    canvas.add(grayPatch);

    // 3. Extract the image clipped to the jittered shape
    const imgElement = originalImage.getElement();
    const offscreen = document.createElement('canvas');
    offscreen.width = cell.width;
    offscreen.height = cell.height;
    const ctx = offscreen.getContext('2d');

    // Clear to transparent
    ctx.clearRect(0, 0, cell.width, cell.height);

    // Draw the jittered clip path
    ctx.beginPath();
    ctx.moveTo(relPoints[0].x, relPoints[0].y);
    for (let i = 1; i < relPoints.length; i++) {
        ctx.lineTo(relPoints[i].x, relPoints[i].y);
    }
    ctx.closePath();
    ctx.clip();

    // Draw the relevant portion of the original image
    ctx.drawImage(
        imgElement,
        cell.left, cell.top, cell.width, cell.height,
        0, 0, cell.width, cell.height
    );

    // 4. Create a fabric.Image from the offscreen canvas
    const dragImg = new fabric.Image(offscreen, {
        left: cell.left,
        top: cell.top,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false
    });

    canvas.add(dragImg);

    canvas.sendToBack(grayPatch);

    canvas.sendToBack(originalImage);

    canvas.renderAll();

    // 5. Set drag state
    window.dragState = {
        image: dragImg,
        offsetX: pointer.x - cell.left,
        offsetY: pointer.y - cell.top
    };
}

function getJitteredPointsRelative(width, height, segmentLength, neighbour) {
    const segmentsX = Math.max(2, Math.floor(width / segmentLength));
    const segmentsY = Math.max(2, Math.floor(height / segmentLength));
    const jitterRange = 5;

    const result = {
        top: [],
        right: [],
        bottom: [],
        left: [],
        all: []
    };

    // Top edge (left → right)
    if (!neighbour || !neighbour.top || !neighbour.top.points) {
        for (let i = 0; i <= segmentsX; i++) {
            let x = (width * i) / segmentsX;
            let y = 0;
            if (i > 0 && i < segmentsX) {
                x += (Math.random() * 2 - 1) * jitterRange;
                y += (Math.random() * 2 - 1) * jitterRange;
            }

            const point = { x, y };
            result.all.push(point);
            result.top.push(point);
        }
    } else {
        const offsetY = -neighbour.top.height;

        const translatedBorderPoints = neighbour.top.points.bottom.toReversed()
            .map(point => ({ ...point, y: point.y + offsetY }));

        result.all.push(...translatedBorderPoints);
        result.top.push(...translatedBorderPoints);
    }

    // Right edge (top → bottom)
    if (!neighbour || !neighbour.right || !neighbour.right.points) {
        for (let i = 1; i <= segmentsY; i++) {
            let x = width;
            let y = (height * i) / segmentsY;
            if (i < segmentsY) {
                x += (Math.random() * 2 - 1) * jitterRange;
                y += (Math.random() * 2 - 1) * jitterRange;
            }

            const point = { x, y };
            result.all.push(point);
            result.right.push(point);
        }
    } else {
        const offsetX = width;

        const translatedBorderPoints = neighbour.right.points.left.toReversed()
            .map(point => ({ ...point, x: point.x + offsetX }));

        result.all.push(...translatedBorderPoints);
        result.right.push(...translatedBorderPoints);
    }

    // Bottom edge (right → left)
    if (!neighbour || !neighbour.bottom || !neighbour.bottom.points) {
        for (let i = 1; i <= segmentsX; i++) {
            let x = width - (width * i) / segmentsX;
            let y = height;
            if (i < segmentsX) {
                x += (Math.random() * 2 - 1) * jitterRange;
                y += (Math.random() * 2 - 1) * jitterRange;
            }

            const point = { x, y };
            result.all.push(point);
            result.bottom.push(point);
        }
    } else {
        const offsetY = height;

        const translatedBorderPoints = neighbour.bottom.points.top.toReversed()
            .map(point => ({ ...point, y: point.y + offsetY }));

        result.all.push(...translatedBorderPoints);
        result.bottom.push(...translatedBorderPoints);
    }

    // Left edge (bottom → top)
    if (!neighbour || !neighbour.left || !neighbour.left.points) {
        for (let i = 1; i < segmentsY; i++) {
            let x = 0;
            let y = height - (height * i) / segmentsY;
            x += (Math.random() * 2 - 1) * jitterRange;
            y += (Math.random() * 2 - 1) * jitterRange;

            const point = { x, y };
            result.all.push(point);
            result.left.push(point);
        }
    } else {
        const offsetX = -neighbour.left.width;

        const translatedBorderPoints = neighbour.left.points.right.toReversed()
            .map(point => ({ ...point, x: point.x + offsetX }));

        result.all.push(...translatedBorderPoints);
        result.left.push(...translatedBorderPoints);
    }

    return result;
}

function pointsToSVGPath(points, offsetX, offsetY) {
    if (points.length === 0) return '';
    let path = `M ${offsetX + points[0].x} ${offsetY + points[0].y}`;
    for (let i = 1; i < points.length; i++) {
        path += ` L ${offsetX + points[i].x} ${offsetY + points[i].y}`;
    }
    path += ' Z';
    return path;
}

function getTextNodesInside(container) {
    const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                // Ignore empty text nodes
                return node.textContent.trim().length > 0
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
            }
        }
    );
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
}

function getTextRectsRelativeToContainer(container) {
    const containerRect = container.getBoundingClientRect();
    const textNodes = getTextNodesInside(container);
    const rects = [];

    textNodes.forEach(node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const clientRects = range.getClientRects();

        for (let rect of clientRects) {
            // Convert viewport-relative rect to container-relative
            rects.push({
                left: rect.left - containerRect.left,
                top: rect.top - containerRect.top,
                right: rect.right - containerRect.left,
                bottom: rect.bottom - containerRect.top
            });
        }
        range.detach();
    });

    return rects;
}