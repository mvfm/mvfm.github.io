
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

$(document).ready(function() {
    console.log("Starting...");

    createTheGrid(true);

    setInterval(function() {
        currentGeneration++;
        console.log(`Creating next generation: ${currentGeneration}`);

        let liveCount = 0;

        // In the first pass we look at the current condition and set NG.
        for (let r = 0; r < ROW_COUNT; r++) {
            for (let c = 0; c < COLUMN_COUNT; c++) {
                let cell = $(`#r${r}_c${c}`);
                let isAlive = cell.attr("alive") === "true";
                let aliveNeighbors = countAliveNeighbors(r, c);

                if (isAlive) {
                    if (aliveNeighbors >= 2 && aliveNeighbors <= 3) {
                        cell.attr("willLive", true);
                    } else {
                        cell.attr("willLive", false);
                    }
                } else if (aliveNeighbors == 3) {
                    cell.attr("willLive", true);
                }
            }
        }

        // In the second pass we use the NG to set the condition.
        for (let r = 0; r < ROW_COUNT; r++) {
            for (let c = 0; c < COLUMN_COUNT; c++) {
                let cell = $(`#r${r}_c${c}`);

                $(cell).css("background-color", DEFAULT_COLOR);

                if (cell.attr("willLive") === "true") {
                    liveCount++;
                    $(cell).css("opacity", 0.8);
                    $(cell).attr("alive", true);
                } else {
                    $(cell).css("opacity", 0.2);
                    $(cell).attr("alive", false);
                }
            }
        }

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
                    $(cell).css("opacity", 0.8);
                    $(cell).attr("alive", true);
                } else {
                    $(cell).css("opacity", 0.2);
                    $(cell).attr("alive", false);
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

                    if (cell.attr("alive") === "true") {
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

                    if (image[row - r][col - c] === "*") {
                        $(cellId).css("background-color", SPECIAL_COLOR);
    
                        $(cellId).css("opacity", 0.8);
                        $(cellId).attr("alive", "true");
                    } else {
                        $(cellId).css("opacity", 0.2);
                        $(cellId).attr("alive", "false");
                    }
                }
            }
        }
    }

    $('.box').hover(
        function() {
            // On mouse over
            $(this).css('opacity', 1);
        },
        function() {
            // On mouse out
            if ($(this).attr("alive") === "true") {
                $(this).css('opacity', 0.8);
            } else {
                $(this).css('opacity', 0.2);
            }
        }
    );

    $('.box').click(function(e) {
        const cellId = $(this).attr("id");
        console.log(`Cell ${cellId} was clicked.`);

        if ($(this).attr("alive") === "true") {
            console.log("It will die.");
            $(this).attr("alive", false);
            $(this).css('opacity', 0.2);
        } else {
            console.log("It will live.");
            $(this).attr("alive", true);
            $(this).css('opacity', 0.8);
        }
    });

    $(document).keydown(function(e) {
        const r = Math.round(Math.random() * ROW_COUNT);
        const c = Math.round(Math.random() * COLUMN_COUNT);

        if (e.key === 'G') {
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

            console.log(`*** Creating a glider gun at ${r}:${c}...`);
            makeAlive(image, r, c);
        } else if (e.key === 'g') {
            const image = [
                '*  ',
                ' **',
                '** '
            ];

            console.log(`*** Creating a glider at ${r}:${c}...`);
            makeAlive(image, r, c);
        } else if (e.key === 'r') {
            createTheGrid(true);
        } else if (e.key === 'c') {
            createTheGrid();
        }
    });

});