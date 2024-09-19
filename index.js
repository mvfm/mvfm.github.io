
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
const CELL_COUNT = ROW_COUNT * COLUMN_COUNT;
const BOX_WIDTH = 10;
const BOX_HEIGHT = 10;
const ALIVE_THRESHOLD = 0.3;
const GENERATIONS_INTERVAL = 1000;
const DEFAULT_COLOR = "white";
const SPECIAL_COLOR = "yellow";

let currentGeneration = 0;
let isDragging = false;

$(document).ready(function() {
    console.log("*** Starting...");

    createTheGrid(true);

    setInterval(function() {
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

    }, GENERATIONS_INTERVAL);


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

    $('.box').hover(
        function() {
            // On mouse over
            $(this).css('opacity', 1);
        },
        function() {
            // On mouse out
            $(this).css('opacity', "");
        }
    );

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