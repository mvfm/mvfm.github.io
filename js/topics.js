// Topic → colour. Hue is the topic's index in the alphabetically-sorted
// full topic list, so callers must pass the SAME list the AI tab uses
// (the `topics` array from the /timeline API response) for colours to match.
export const getTopicColor = (topicName, allTopics, isEnabled = true) => {
    const sorted = [...(allTopics || [])].sort();
    const index = sorted.indexOf(topicName);
    if (index === -1) return isEnabled ? 'var(--clr-primary)' : '#cbd5e1';

    const hue = (index * 18) % 360;
    const saturation = isEnabled ? 70 : 15;
    const lightness = isEnabled ? 45 : 85;
    const alpha = isEnabled ? 1 : 0.6;
    return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
};

// Short, collision-free acronyms for topic pills. Like getTopicColor, the
// result depends on the WHOLE sorted topic list, so callers must pass the
// same list the AI tab uses for the acronyms to match the timeline.
const topicMnemonics = new Map();

export const generateMnemonics = (topics) => {
    topicMnemonics.clear();
    const used = new Set();
    const sorted = [...(topics || [])].sort();

    sorted.forEach(topic => {
        const words = topic.toLowerCase().split(' ');
        let mnemonic = "";

        // 1. First letter of each word (multi-word topics)
        if (words.length > 1) {
            mnemonic = words.map(w => w[0]).join('').slice(0, 3);
        }
        // 2. Single word or collision: first 2 letters
        if (!mnemonic || used.has(mnemonic)) {
            mnemonic = topic.slice(0, 2).toLowerCase();
        }
        // 3. Still colliding: walk further letters
        let len = 2;
        while (used.has(mnemonic) && len < topic.length) {
            mnemonic = (topic[0] + topic[++len - 1]).toLowerCase();
        }
        // 4. Last resort: append a digit
        if (used.has(mnemonic)) {
            mnemonic = topic.slice(0, 2).toLowerCase() + used.size;
        }

        used.add(mnemonic);
        topicMnemonics.set(topic, mnemonic);
    });
};

export const getTopicInitials = (topicName) =>
    topicMnemonics.get(topicName) || topicName.slice(0, 2).toLowerCase();
