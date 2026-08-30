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
