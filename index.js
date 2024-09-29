
/*
 * Conway's Game of Life
 * 
 * Any live cell with fewer than two live neighbours dies, as if by underpopulation.
 * Any live cell with two or three live neighbours lives on to the next generation.
 * Any live cell with more than three live neighbours dies, as if by overpopulation.
 * Any dead cell with exactly three live neighbours becomes a live cell, as if by reproduction.
 */

const ROW_COUNT = 50;
const COLUMN_COUNT = 90;
const BOX_WIDTH = 10;
const BOX_HEIGHT = 10;
const BOX_MARGIN = 1;
const ALIVE_THRESHOLD = 0.3;
const GENERATIONS_INTERVAL = 1000;
const DEFAULT_COLOR = "white";
const SPECIAL_COLOR = "yellow";

const CELL_COUNT = ROW_COUNT * COLUMN_COUNT;
const ROW_REAL_WIDTH = (COLUMN_COUNT * BOX_WIDTH) + ((COLUMN_COUNT - 1) * (BOX_MARGIN * 2));

let currentGeneration = 0;
let realRowWidth = 0;       // Will be changed in createTheStatusLine()
let isDragging = false;

$(document).ready(function() {
    console.log("*** Starting...");

    createTheGrid(true);
    createTheStatusLine();

    setInterval(updateTheGrid, GENERATIONS_INTERVAL);


    /*
     * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
    */


    function createTheGrid(makeAlive) {
        console.log("*** Creating the grid...");
        currentGeneration = 0;

        let mainElement = $("main");
        $(mainElement).empty();
    
        for (let r = 0; r < ROW_COUNT; r++) {
            let row = $("<div>");
            $(row).addClass("row");
            $(mainElement).append(row);
    
            for (let c = 0; c < COLUMN_COUNT; c++) {
                let alive = makeAlive ? Math.random() <= ALIVE_THRESHOLD : false;
    
                let cell = $("<div>");
                $(cell).attr("id", `r${r}_c${c}`);
                $(cell).addClass("box");
    
                if (alive) {
                    $(cell).addClass("alive highlight");
                }
    
                $(row).append(cell);
            }
        }
    }

    function createTheStatusLine() {
        console.log("*** Creating the status line...");

        let cellWidth = parseInt(getCSSPropertyValue("box", "width"), 10);
        let cellMargin = parseInt(getCSSPropertyValue("box", "margin"), 10);
        let statusLineWidth = (COLUMN_COUNT * cellWidth) + ((COLUMN_COUNT - 1) * (cellMargin * 2));  // 1078px?
        console.log(`*** cellWidth: ${cellWidth}, cellMargin: ${cellMargin}, statusLineWIdth: ${statusLineWidth}`);

        let mainElement = $("main");
        let statusLine = $("<div>");
        $(statusLine).addClass("status");
        $(statusLine).css("width", `${statusLineWidth}px`);
        $(statusLine).text("123/456");

        mainElement.append(statusLine);
    }

    function updateTheGrid() {
        currentGeneration++;
        console.log(`Creating the next generation: ${currentGeneration}`);

        $(".box").removeClass("highlight");

        let liveCount = 0;

        for (let r = 0; r < ROW_COUNT; r++) {
            for (let c = 0; c < COLUMN_COUNT; c++) {
                let cell = $(`#r${r}_c${c}`);
                let aliveNeighbors = countAliveNeighbors(r, c);

                if (cell.hasClass("alive")) {
                    if (aliveNeighbors >= 2 && aliveNeighbors <= 3) {
                        cell.attr("willLive", true);
                        liveCount++;
                    }
                } else if (aliveNeighbors == 3) {
                    cell.attr("willLive", true);
                    liveCount++;
                }
            }
        }

        $(".box[willLive]").addClass("alive");
        $(".box:not([willLive])").removeClass("alive");
        $(".box[willLive]").removeAttr("willLive");

        let occupationRate = liveCount * 100 / CELL_COUNT;
        console.log(`The live count is ${liveCount}, and the occupation rate is ${occupationRate} %.`);

        $(".status").text(`${formatNumber(currentGeneration, 6, 0)} | ${formatNumber(liveCount, 4, 0)}/${formatNumber(CELL_COUNT, 4, 0)} | ${formatNumber(occupationRate, 3, 2)} %`);
    }

    function countAliveNeighbors(r, c) {
        const minR = r > 1 ? r - 1 : r;
        const maxR = r < ROW_COUNT - 1 ? r + 1 : r;
        const minC = c > 1 ? c - 1 : c;
        const maxC = c < COLUMN_COUNT - 1 ? c + 1 : c;

        let aliveNeighbors = 0;

        for (let i = minR; i <= maxR; i++) {
            for (let j = minC; j <= maxC; j++) {
                if (i != r || j != c) {
                    let cell = $(`#r${i}_c${j}`);

                    if (cell.hasClass("alive")) {
                        aliveNeighbors++;
                    }
                }
            }
        }

        return aliveNeighbors;
    }

    function makeAlive(image, r, c) {
        for (let row = r; row < r + image.length; row++) {
            for (let col = c; col < c + image[row - r].length; col++) {
                if (row < ROW_COUNT && col < COLUMN_COUNT) {
                    let cellId = `#r${row}_c${col}`;

                    if (image[row - r][col - c] != " ") {
                        $(cellId).addClass("alive highlight");
                    } else {
                        $(cellId).removeClass("alive");
                    }
                }
            }
        }
    }

    function random(available, size) {
        let theMax = available - size;
        return Math.round(Math.random() * theMax);
    }

    function formatNumber(number, totalIntegerLength, decimalPlaces) {
        // Convert number to a fixed decimal string
        let [integerPart, decimalPart] = number
            .toFixed(decimalPlaces)  // Formats the number with given decimal places
            .split('.');             // Split into integer and decimal parts
    
        // Pad integer part with leading zeros
        integerPart = integerPart.padStart(totalIntegerLength, '0');
    
        // Join integer and decimal parts
        return decimalPart ? `${integerPart}.${decimalPart}` : integerPart;
    }

    function getCSSPropertyValue(className, property) {
        const $tempElement = $('<div>')
            .addClass(className)
            .css('display', 'none')
            .appendTo('body');
    
        const value = $tempElement.css(property);
    
        // Clean up: Remove the temporary element
        $tempElement.remove();
    
        // Return the CSS property value
        return value;
    }

    function drawGliderGun() {
        console.log('*** Creating a glider...');

        const image = [
            '                                        ',
            '                                        ',
            '                           *            ',
            '                        ****    *       ',
            '               *       ****     *       ',
            '              * *      *  *         **  ',
            '             *   **    ****         **  ',
            '  **         *   **     ****            ',
            '  **         *   **        *            ',
            '              * *                       ',
            '               *                        ',
            '                                        ',
            '                                        '
        ];

        const r = random(ROW_COUNT, image.length);
        const c = random(COLUMN_COUNT, image[0].length);

        makeAlive(image, r, c);
    }

    function drawGlider() {
        console.log('*** Creating a glider...');

        const image = [
            '       ',
            '       ',
            '  *    ',
            '   **  ',
            '  **   ',
            '       ',
            '       '
        ];

        const r = Math.round(Math.random() * ROW_COUNT);
        const c = Math.round(Math.random() * COLUMN_COUNT);

        makeAlive(image, r, c);
    }

    $('.box').mousedown(function() {
        isDragging = true;

        $(this).toggleClass('alive');
    });

    $('.box').mouseenter(function() {
        if (isDragging) {
            $(this).toggleClass('alive');
        }
    });

    $(document).mouseup(function() {
        isDragging = false;
    });

    $(document).keydown(function(e) {
        if (e.key == 'G') {
            drawGliderGun();
        } else if (e.key === 'g') {
            drawGlider();
        } else if (e.key === 'r') {
            createTheGrid(true);
        } else if (e.key === 'c') {
            createTheGrid();
        }
    });
});