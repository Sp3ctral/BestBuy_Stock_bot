// API rate limiter, the bestbuy API, and the search conditions/options
const Bottleneck = require("bottleneck");
const bb = require('bestbuy')('XnuOA5EJQxehDiWfRU0kPsAG');
const nodemailer = require("nodemailer");
const conditions = '(search=3070|search=3080)&(categoryPath.id=abcat0507002)&' +
    '(manufacturer=NVIDIA|manufacturer=EVGA)&(regularPrice<=800)&(sku=64294' +
        '42|sku=6439300|sku=6429440|sku=6432399)';
var showOptions = 'name,regularPrice,addToCartUrl,url,onlineAvailability,sku,image,manufacturer';

// variables and arrays to process data and the API rate limiter
var finalData, stats;
var candidateCards = [0, 0, 0, 0];
var limiter = new Bottleneck({maxConcurrent: 1, minTime: 800});

// Mail service configuration using Nodemailer
var transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {user: 'EMAIL HERE', pass: 'PASS HERE'}
});
var mailOptions = {from: '', to: '', subject: 'SHAD0W GPU BOT', text: ''};

var previouslySent = [];
var lastSentArray = [];


/**
 * Gets the GPUs from the API and loads the data into the global vars
 *
 * @returns VoidFunction
 */
async function getProducts()
{
    try
    {
        // Rate-limit the API requests with Bottleneck
        await limiter.schedule(() => bb.products(conditions,
        {show: showOptions ,sort: 'regularPrice.asc', pageSize: 10}))
        .then((data) =>
        {
            stats = data.totalTime;
            finalData = data.products;
        });
    }
    catch (error)
    {
        console.error('Error: ' + '[' + error.body.errorCode + '] ' +
            error.body.errorMessage + '\n');
    }
}

/**
 * Runs the continuous stream to check for the stock.
 *
 * @returns VoidFunction
 */
async function runStream()
{
    // Load the initial data so the loop has starting data
    await getProducts();
    var manualIterator = 2;
    var stockBooleanTracker = 1;

    // Starts the search loop.
    while (true)
    {
        // If the current GPU is in stock online...
        if (finalData[manualIterator - 2].onlineAvailability) // If the GPUs are in stock...
        {
            // Add the in stock GPUs add-to-cart link to the even indices of the candidate array
            candidateCards[manualIterator - 2] = finalData[manualIterator - 2].addToCartUrl;

            // Add the live stock status boolean on the right if the link ====> ['URL', true, 'URL', false]
            candidateCards.splice(stockBooleanTracker, 0, finalData[manualIterator - 2].onlineAvailability);
        }
        // Splice the data so the indices sync with the candidate GPU placements
        finalData.splice(stockBooleanTracker, 0, '');

        // Go on to the next GPU...
        manualIterator += 2;
        stockBooleanTracker += 2;


        // Once we reach the end of the GPUs, recheck them for stock changes
        if (manualIterator == 10 && stockBooleanTracker == 9)
        {
            // Process the data for the email
            processMailData(candidateCards);

            if (!alreadyMailed())
            {
                previouslySent = [...lastSentArray];
                sendMail(candidateCards);
            }

            //  Reset settings and vars to beginning
            var reset = await resetProcedure(manualIterator, stockBooleanTracker, candidateCards);

            manualIterator = reset[0];
            stockBooleanTracker = reset[1];
            candidateCards = reset[2];


        }

    }
}

/**
 * Debugging function to simulate an API rate limiter.
 * @param ms Amount in ms to sleep for.
 * @returns {Promise}
 */
function sleep(ms)
{
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Resets the variables and setting to the beginning to initiate the loop.
 *
 * @param manualIterator The counter the moves to the next item
 * @param stockBoolean The boolean counter that tracks the booleans of the item
 * @param candidateCards The array that houses the candidate GPUs
 * @returns {Promise<(number|number[])[]>} An array of the new reset values
 */
async function resetProcedure(manualIterator, stockBoolean, candidateCards)
{
    // If we are at the end of our current cycle, reset the cycle loop counters.
    if (manualIterator == 10)
    {
        manualIterator = 2;

        //TODO: FOR CONSOLE OUTPUT/DEBUGGING!
        console.log('Cards detected: ', candidateCards);
    }
    if (stockBoolean == 9)
    {
        stockBoolean = 1;
    }

    // Reset stuff to its original state...
    candidateCards = [0, 0, 0, 0];
    await getProducts();
    return [manualIterator, stockBoolean, candidateCards];
}

/**
 * Processes the data into aa final array that will include the cards to be
 * emailed.
 *
 * @param candidateArray The array that contains the sorted candidate cards.
 */
function processMailData(candidateArray)
{
    var firstIteration = lastSentArray.length == 0;

    // Logic to detect if the current array has been iterated through and checked
    // to be sorted.
    for (var i = 0; i < candidateArray.length; i++)
    {
        if (firstIteration && typeof candidateArray[i] === 'string')
        {
            lastSentArray.splice(i, 0, candidateArray[i]);
        }
        if (!firstIteration)
        {
            var elementIndex = lastSentArray.indexOf(candidateArray[i]);
            if (elementIndex === -1 && typeof candidateArray[i] === 'string')
            {
                lastSentArray.splice(i, 0, candidateArray[i]);
            }
        }
    }
    //TODO: FOR CONSOLE OUTPUT/DEBUGGING!
    console.log('Cards Emailed: ' + lastSentArray + '\n');
}

/**
 * Detects if the cards that were last mailed match the cards that are
 * about to be sent.
 *
 * @returns {boolean|boolean} If the cards currently being checked are duplicates.
 */
function alreadyMailed()
{
    return (lastSentArray.length === previouslySent.length &&
        lastSentArray.every((val, index) => val === previouslySent[index]));
}

/**
 * Sends an email with the cards that are in stock and ready for checkout.
 *
 * @param candidateCards The array that contains the sorted candidate cards.
 */
function sendMail(candidateCards)
{
    var mailText = '';
    var innerLoopCounter = 0;

    // Loop through the cards about to be sent to identify cards not yet in stock.
    for (var i = 0; i < finalData.length; i+=2)
    {
        if (lastSentArray[innerLoopCounter] != undefined)
        {
            mailText += finalData[i].name + ": " + lastSentArray[innerLoopCounter] + '\n';
        }
        else
        {
            mailText += finalData[i].name + ": " + 'Not in stock yet!' + '\n';
        }
        innerLoopCounter += 1;
    }
    mailOptions.text = mailText;

    // Send the cards in an email.
    transporter.sendMail(mailOptions, function(error, info)
    {
        if (error)
        {
            console.error('Mailing Error Detected: ' + error);
        }
        else
        {
            console.log('Email sent: ' + info.response);
        }
    });
}

runStream();


