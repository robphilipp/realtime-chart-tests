import {default as React, useEffect, useRef} from "react";
import * as d3 from "d3";
import {adjustedDimensions, Margin} from "./margins";
import {Datum, PixelDatum, Series} from "./datumSeries";
import {TimeRange, TimeRangeType} from "./timeRange";
import {Selection, Axis, Line, ScaleLinear, ScaleBand} from "d3";
import {defaultTooltipStyle, TooltipStyle} from "./TooltipStyle";

const defaultMargin = {top: 30, right: 20, bottom: 30, left: 50};
const defaultAxesStyle = {color: '#d2933f'};
const defaultAxesLabelFont = {
    size: 12,
    color: '#d2933f',
    weight: 300,
    family: 'sans-serif'
};
const defaultSpikesStyle = {
    color: '#c95d15',
    lineWidth: 2,
    highlightColor: '#d2933f',
    highlightWidth: 4
};
const defaultPlotGridLines = {visible: true, color: 'rgba(210,147,63,0.35)'};


interface Axes {
    xAxis: Axis<number | {valueOf(): number}>;
    yAxis: Axis<number | {valueOf(): number}>;
    xAxisSelection: AxisElementSelection;
    yAxisSelection: AxisElementSelection;
    xScale: ScaleLinear<number, number>;
    yScale: ScaleLinear<number, number>;
}

// the axis-element type return when calling the ".call(axis)" function
type AxisElementSelection = Selection<SVGGElement, unknown, null, undefined>;
type SvgSelection = Selection<SVGSVGElement, any, null, undefined>;

interface Props {
    width: number;
    height: number;
    margin?: Partial<Margin>;
    axisLabelFont?: Partial<{ size: number, color: string, family: string, weight: number }>;
    axisStyle?: Partial<{ color: string }>;
    backgroundColor?: string;
    spikesStyle?: Partial<{color: string, lineWidth: number, highlightColor: string, highlightWidth: number}>;
    plotGridLines?: Partial<{ visible: boolean, color: string }>;
    tooltip?: Partial<TooltipStyle>;

    minWeight?: number;
    maxWeight?: number;

    // data to plot: min-time is the earliest time for which to plot the data; max-time is the latest
    // and series list is a list of time-series to plot
    minTime: number;
    maxTime: number;
    seriesList: Array<Series>;
}

/**
 *
 * @param {Props} props
 * @return {JSX.Element}
 * @constructor
 */
function ScatterChart(props: Props): JSX.Element {

    const {
        width,
        height,
        backgroundColor = '#202020',
        minWeight = -1, maxWeight = 1,
        minTime, maxTime,
        seriesList
    } = props;

    // override the defaults with the parent's properties, leaving any unset values as the default value
    const margin = {...defaultMargin, ...props.margin};
    const axisStyle = {...defaultAxesStyle, ...props.axisStyle};
    const axisLabelFont = {...defaultAxesLabelFont, ...props.axisLabelFont};
    const plotGridLines = {...defaultPlotGridLines, ...props.plotGridLines};
    const tooltip: TooltipStyle = {...defaultTooltipStyle, ...props.tooltip, visible: true};
    const spikesStyle = {...defaultSpikesStyle, ...props.spikesStyle};

    // grab the dimensions of the actual plot after removing the margins from the specified width and height
    const plotDimensions = adjustedDimensions(width, height, margin);

    // the container that holds the d3 svg element
    const containerRef = useRef<SVGSVGElement>(null);
    const mainGRef = useRef<Selection<SVGGElement, any, null, undefined>>();
    const spikesRef = useRef<Selection<SVGGElement, Series, SVGGElement, any>>();
    const magnifierRef = useRef<Selection<SVGRectElement, Datum, null, undefined>>();
    const trackerRef = useRef<Selection<SVGLineElement, Datum, null, undefined>>();

    const mouseCoordsRef = useRef<number>(0);
    const zoomFactorRef = useRef<number>(1);

    // reference to the axes for the plot
    const axesRef = useRef<Axes>();

    // reference for the min/max values
    const minValueRef = useRef<number>(minWeight);
    const maxValueRef = useRef<number>(maxWeight);

    // unlike the magnifier, the handler forms a closure on the tooltip properties, and so if they change in this
    // component, the closed properties are unchanged. using a ref allows the properties to which the reference
    // points to change.
    const tooltipRef = useRef(tooltip);

    // calculates to the time-range based on the (min, max)-time from the props
    const timeRangeRef = useRef<TimeRangeType>(TimeRange(minTime, maxTime));

    function updateMinMaxValues(data: Array<[number, number]>[]): [number, number] {
        const minValue = d3.min(data, series => d3.min(series, datum => datum[1])) || 0;
        const maxValue = d3.max(data, series => d3.max(series, datum => datum[1])) || 1;
        minValueRef.current = Math.min(minValue, minValueRef.current);
        maxValueRef.current = Math.max(maxValue, maxValueRef.current);
        return [minValueRef.current, maxValueRef.current];
    }

    function initializeAxes(svg: SvgSelection): Axes {
        // initialize the x-axis
        const xScale = d3.scaleLinear()
            .domain([timeRangeRef.current.start, timeRangeRef.current.end])
            .range([0, plotDimensions.width])
        ;
        const xAxis = d3.axisBottom(xScale);
        const xAxisSelection = svg
            .append<SVGGElement>('g')
            .attr('class', 'x-axis')
            .attr('transform', `translate(${margin.left}, ${plotDimensions.height})`)
        ;

        svg
            .append<SVGTextElement>('text')
            .attr('text-anchor', 'middle')
            .attr('font-size', axisLabelFont.size)
            .attr('fill', axisLabelFont.color)
            .attr('font-family', axisLabelFont.family)
            .attr('font-weight', axisLabelFont.weight)
            .attr('transform', `translate(${margin.left + plotDimensions.width / 2}, ${plotDimensions.height + margin.top + (margin.bottom / 3)})`)
            .text("t (ms)");


        // initialize the y-axis
        const yScale = d3.scaleLinear()
            .domain([minWeight, maxWeight])
            .range([plotDimensions.height - margin.bottom, 0])
        ;
        const yAxis = d3.axisLeft(yScale);
        const yAxisSelection = svg
            .append<SVGGElement>('g')
            .attr('class', 'y-axis')
            .attr('transform', `translate(${margin.left}, ${margin.top})`)
        ;

        // create the clipping region so that the lines are clipped at the y-axis
        svg
            .append("defs")
            .append("clipPath")
            .attr("id", "clip")
            .append("rect")
            .attr("width", plotDimensions.width)
            .attr("height", plotDimensions.height - margin.top)
        ;

        return {
            xAxis, yAxis,
            xAxisSelection, yAxisSelection,
            xScale, yScale
        };
    }

    interface Interval {
        tLower: number;
        tUpper: number;
        vLower: number;
        vUpper: number;
    }

    /**
     * Returns the index of the data point whose time is the upper boundary on the specified
     * time. If the specified time is larger than any time in the specified data, the returns
     * the length of the data array. If the specified time is smaller than all the values in
     * the specified array, then returns -1.
     * @param {Array<[number, number]>} data The array of points from which to select the
     * boundary.
     * @param {number} time The time for which to find the bounding points
     * @return {number} The index of the upper boundary.
     */
    function boundingPointsIndex(data: Array<[number, number]>, time: number): number {
        const length = data.length;
        if(time > data[length-1][0]) {
            return length;
        }
        if(time < data[0][0]) {
            return 0;
        }
        return data.findIndex((value, index, array) => {
            const lowerIndex = Math.max(0, index-1);
            return array[lowerIndex][0] <= time && time <= array[index][0];
        })
    }

    function boundingPoints(data: Array<[number, number]>, time: number): [[number, number], [number, number]] {
        const upperIndex = boundingPointsIndex(data, time);
        if(upperIndex <= 0) {
            return [[NaN, NaN], data[0]];
        }
        if(upperIndex >= data.length) {
            return [data[data.length-1], [NaN, NaN]];
        }
        return [data[upperIndex-1], data[upperIndex]];
    }

    function valueDisplay(lower: [number, number], upper: [number, number]): string {
        // `${d3.format(",.0f")(time)} ms, ${d3.format(".2")(value)}`
        if(isNaN(lower[0])) {
            return `${d3.format(",.0f")(upper[0])} ms, ${d3.format(".2")(upper[1])}`
        }
        if(isNaN(upper[0])) {
            return `${d3.format(",.0f")(lower[0])} ms, ${d3.format(".2")(lower[1])}`
        }
        const deltaTime = upper[0] - lower[0];
        const deltaValue = upper[1] - lower[1];
        return `${d3.format(",.0f")(lower[0])} ms, ${d3.format(".2")(lower[1])}\n
        ${d3.format(",.0f")(upper[0])} ms, ${d3.format(".2")(upper[1])}\n
        ${d3.format(",.0f")(deltaTime)} ms, ${d3.format(".2")(deltaValue)}
        `;
    }

    /**
     * Renders a tooltip showing the neuron, spike time, and the spike strength when the mouse hovers over a spike.
     * @param {Datum} datum The spike datum (t ms, s mV)
     * @param {string} seriesName The name of the series (i.e. the neuron ID)
     * @param {SVGPathElement} segment The SVG line element representing the spike, over which the mouse is hovering.
     */
    function handleShowTooltip(datum: Array<[number, number]>, seriesName: string, segment: SVGPathElement): void {
        if(!tooltipRef.current.visible || !containerRef.current || !axesRef.current) {
            return;
        }

        const [x, y] = d3.mouse(containerRef.current);
        const time = Math.round(axesRef.current.xScale.invert(x - margin.left));
        const [lower, upper] = boundingPoints(datum, time);

        // Use D3 to select element, change color and size
        d3.select<SVGPathElement, Datum>(segment)
            .attr('stroke', spikesStyle.highlightColor)
            .attr('stroke-width', spikesStyle.highlightWidth)
        ;

        if (tooltipRef.current.visible) {
            // create the rounded rectangle for the tooltip's background
            const rect = d3.select<SVGSVGElement | null, any>(containerRef.current)
                .append<SVGRectElement>('rect')
                .attr('id', `r${time}-${seriesName}`)
                .attr('class', 'tooltip')
                .attr('rx', tooltipRef.current.borderRadius)
                .attr('fill', tooltipRef.current.backgroundColor)
                .attr('fill-opacity', tooltipRef.current.backgroundOpacity)
                .attr('stroke', tooltipRef.current.borderColor)
                .attr('stroke-width', tooltipRef.current.borderWidth)
            ;

            // display the neuron ID in the tooltip
            const header = d3.select<SVGSVGElement | null, any>(containerRef.current)
                .append<SVGTextElement>("text")
                .attr('id', `tn${time}-${seriesName}`)
                .attr('class', 'tooltip')
                .attr('fill', tooltipRef.current.fontColor)
                .attr('font-family', 'sans-serif')
                .attr('font-size', tooltipRef.current.fontSize)
                .attr('font-weight', tooltipRef.current.fontWeight)
                .text(() => seriesName)
            ;

            let lowerPointText: d3.Selection<SVGTextElement, any, null, undefined> | undefined = undefined;
            if(!isNaN(lower[0])) {
                lowerPointText = d3.select<SVGSVGElement | null, any>(containerRef.current)
                    .append<SVGTextElement>("text")
                    .attr('id', `t${time}-${seriesName}`)
                    .attr('class', 'tooltip')
                    .attr('fill', tooltipRef.current.fontColor)
                    .attr('font-family', 'sans-serif')
                    .attr('font-size', tooltipRef.current.fontSize + 2)
                    .attr('font-weight', tooltipRef.current.fontWeight + 150)
                    .text(() => `lower: ${d3.format(",.0f")(lower[0])} ms, ${d3.format(".2")(lower[1])}`)
                ;
            }

            let upperPointText: d3.Selection<SVGTextElement, any, null, undefined> | undefined = undefined;
            if(!isNaN(upper[0])) {
                upperPointText = d3.select<SVGSVGElement | null, any>(containerRef.current)
                    .append<SVGTextElement>("text")
                    .attr('id', `t${time}-${seriesName}`)
                    .attr('class', 'tooltip')
                    .attr('fill', tooltipRef.current.fontColor)
                    .attr('font-family', 'sans-serif')
                    .attr('font-size', tooltipRef.current.fontSize + 2)
                    .attr('font-weight', tooltipRef.current.fontWeight + 150)
                    .text(() => `upper: ${d3.format(",.0f")(upper[0])} ms, ${d3.format(".2")(upper[1])}`)
                ;
            }

            let deltaText: d3.Selection<SVGTextElement, any, null, undefined> | undefined = undefined;
            if(lowerPointText && upperPointText) {
                deltaText = d3.select<SVGSVGElement | null, any>(containerRef.current)
                    .append<SVGTextElement>("text")
                    .attr('id', `t${time}-${seriesName}`)
                    .attr('class', 'tooltip')
                    .attr('fill', tooltipRef.current.fontColor)
                    .attr('font-family', 'sans-serif')
                    .attr('font-size', tooltipRef.current.fontSize + 2)
                    .attr('font-weight', tooltipRef.current.fontWeight + 150)
                    .text(() => `change: ${d3.format(",.0f")(upper[0] - lower[0])} ms, ${d3.format(".2")(upper[1] - lower[1])}`)
                ;
            }

            // calculate the max width and height of the text
            const tooltipWidth = Math.max(
                header.node()?.getBBox()?.width || 0,
                lowerPointText?.node()?.getBBox()?.width || 0,
                upperPointText?.node()?.getBBox()?.width || 0,
                deltaText?.node()?.getBBox()?.width || 0
            );
            const headerTextHeight = header.node()!.getBBox()!.height || 0;
            const lowerHeight = lowerPointText?.node()?.getBBox()?.height || 0;
            const upperHeight = upperPointText?.node()?.getBBox()?.height || 0;
            const deltaHeight = deltaText?.node()?.getBBox()?.height || 0;
            const textHeight = headerTextHeight + lowerHeight + upperHeight + deltaHeight;

            // set the header text location
            header
                .attr('x', () => tooltipX(x, tooltipWidth) + tooltipRef.current.paddingLeft)
                .attr('y', () => tooltipY(y, textHeight) - (lowerHeight + upperHeight + deltaHeight) + textHeight + tooltipRef.current.paddingTop)
            ;

            if(lowerPointText) {
                lowerPointText
                    .attr('x', () => tooltipX(x, tooltipWidth) + tooltipRef.current.paddingLeft)
                    .attr('y', () => tooltipY(y, textHeight) + headerTextHeight + lowerHeight + tooltipRef.current.paddingTop)
                ;
            }
            if(upperPointText) {
                upperPointText!
                    .attr('x', () => tooltipX(x, tooltipWidth) + tooltipRef.current.paddingLeft)
                    .attr('y', () => tooltipY(y, textHeight) + headerTextHeight + lowerHeight + upperHeight + tooltipRef.current.paddingTop)
                ;
            }
            if(deltaText) {
                deltaText!
                    .attr('x', () => tooltipX(x, tooltipWidth) + tooltipRef.current.paddingLeft)
                    .attr('y', () => tooltipY(y, textHeight) + textHeight + tooltipRef.current.paddingTop)
                ;
            }

            // set the position, width, and height of the tooltip rect based on the text height and width and the padding
            rect.attr('x', () => tooltipX(x, tooltipWidth))
                .attr('y', () => tooltipY(y, textHeight))
                .attr('width', tooltipWidth + tooltipRef.current.paddingLeft + tooltipRef.current.paddingRight)
                .attr('height', textHeight + tooltipRef.current.paddingTop + tooltipRef.current.paddingBottom)
            ;
        }
    }

    /**
     * Calculates the x-coordinate of the lower left-hand side of the tooltip rectangle (obviously without
     * "rounded corners"). Adjusts the x-coordinate so that tooltip is visible on the edges of the plot.
     * @param {number} x The current x-coordinate of the mouse
     * @param {number} textWidth The width of the tooltip text
     * @return {number} The x-coordinate of the lower left-hand side of the tooltip rectangle
     */
    function tooltipX(x: number, textWidth: number): number {
        if(x + textWidth + tooltip.paddingLeft + 10 > plotDimensions.width + margin.left) {
            return x - textWidth - tooltip.paddingRight - margin.right;
        }
        return x + tooltip.paddingLeft;
    }

    /**
     * Calculates the y-coordinate of the lower-left-hand corner of the tooltip rectangle. Adjusts the y-coordinate
     * so that the tooltip is visible on the upper edge of the plot
     * @param {number} y The y-coordinate of the series
     * @param {number} textHeight The height of the header and neuron ID text
     * @return {number} The y-coordinate of the lower-left-hand corner of the tooltip rectangle
     */
    function tooltipY(y: number, textHeight: number): number {
        return y + margin.top - tooltip.paddingBottom - textHeight - tooltip.paddingTop;
    }

    /**
     * Removes the tooltip when the mouse has moved away from the spike
     * @param {Datum} datum The spike datum (t ms, s mV)
     * @param {string} seriesName The name of the series (i.e. the neuron ID)
     * @param {SVGPathElement} segment The SVG line element representing the spike, over which the mouse is hovering.
     */
    function handleHideTooltip(datum: Array<[number, number]>, seriesName: string, segment: SVGPathElement) {
        // Use D3 to select element, change color and size
        d3.select<SVGPathElement, Datum>(segment)
            // .attr('stroke', spikesStyle.color)
            // .attr('stroke-width', spikesStyle.lineWidth);
            .attr('stroke', 'steelblue')
            .attr('stroke-width', 1);

        if(tooltipRef.current.visible) {
            d3.selectAll<SVGPathElement, Datum>('.tooltip').remove();
        }
    }

    /**
     * Updates the plot data for the specified time-range, which may have changed due to zoom or pan
     * @param {TimeRange} timeRange The current time range
     */
    function updatePlot(timeRange: TimeRangeType) {
        // tooltipRef.current = tooltip;
        timeRangeRef.current = timeRange;

        if (containerRef.current && axesRef.current) {
            // select the text elements and bind the data to them
            const svg = d3.select<SVGSVGElement, any>(containerRef.current);

            // create the tensor of data (time, value)
            const data: Array<Array<[number, number]>> = seriesList.map(series => selectInTimeRange(series));

            // calculate and update the min and max values for updating the y-axis. only updates when
            // the min is less than the historical min, and the max is larger than the historical max.
            const [minValue, maxValue] = updateMinMaxValues(data);

            // create the x-axis
            axesRef.current.xScale.domain([timeRangeRef.current.start, timeRangeRef.current.end]);
            axesRef.current.xAxisSelection.call(axesRef.current.xAxis);

            // create the y-axis
            axesRef.current.yScale.domain([Math.max(minWeight, minValue), Math.min(maxWeight, maxValue)]); // todo should this be dynamic?
            axesRef.current.yAxisSelection.call(axesRef.current.yAxis);

            // set up the main <g> container for svg and translate it based on the margins, but do it only
            // once
            if(mainGRef.current === undefined) {
                mainGRef.current = svg
                    .attr('width', width)
                    .attr('height', height)
                    .attr('color', axisStyle.color)
                    .append<SVGGElement>('g')
                ;
            }

            seriesList.forEach(series => {

                const data = selectInTimeRange(series);

                if (data.length === 0) return;

                // Create a update selection: bind to the new data
                mainGRef.current!
                    .selectAll(`#${series.name}`)
                    .data([data, data], () => `${series.name}-${timeRangeRef.current.end}`)
                    .join(
                        enter => enter
                            .append("path")
                            .attr("id",`${series.name}`)
                            .attr("d", d3.line()
                                .x((d: [number, number]) => axesRef.current!.xScale(d[0]))
                                .y((d: [number, number]) => axesRef.current!.yScale(d[1])))
                            .attr("fill", "none")
                            .attr("stroke", "steelblue")
                            .attr("stroke-width", 1)
                            .attr('transform', `translate(${margin.left}, ${margin.top})`)
                            .attr("clip-path", "url(#clip)")
                            .on(
                                "mouseover",
                                (datumArray, i, group) => handleShowTooltip(datumArray, series.name, group[i])
                            )
                            .on(
                                "mouseleave",
                                (datumArray, i, group) => handleHideTooltip(datumArray, series.name, group[i])
                            )
                );
            });
        }
    }

    /**
     * Returns the data in the time-range and the datum that comes just before the start of the time range.
     * The point before the time range is so that the line draws up to the y-axis, where it is clipped.
     * @param {Series} series The series
     * @return {Array<[number, number]>} An array of (time, value) points that fit within the time range,
     * and the point just before the time range.
     */
    function selectInTimeRange(series: Series): Array<[number, number]> {

        function inTimeRange(datum: Datum, index: number, array: Datum[]): boolean {
            // also want to include the point whose next value is in the time range
            const nextDatum = array[Math.min(index + 1, array.length - 1)];
            return nextDatum.time >= timeRangeRef.current.start && datum.time <= timeRangeRef.current.end;
        }

        return series.data
            .filter((datum: Datum, index: number, array: Datum[]) => inTimeRange(datum, index, array))
            .map(datum => [datum.time, datum.value]);
    }

    useEffect(
        () => {
            if(containerRef.current) {
                const svg = d3.select<SVGSVGElement, any>(containerRef.current);
                axesRef.current = initializeAxes(svg);
                // mainGRef.current = svg.append("g").append("weights");
            }
        },
        []
    );

    // called when:
    // 1. component mounts to set up the main <g> element and a <g> element for each series
    //    into which d3 renders the series
    // 2. series data changes
    // 3. time-window changes
    // 4. plot attributes change
    useEffect(
        () => {
            const timeRange = timeRangeRef.current.matchesOriginal(minTime, maxTime) ? timeRangeRef.current : TimeRange(minTime, maxTime);
            updatePlot(timeRange);
        }
    );

    return (
        <svg
            className="streaming-scatter-chart-d3"
            width={width}
            height={height * seriesList.length}
            style={{backgroundColor: backgroundColor}}
            ref={containerRef}
        />
    );
}

export default ScatterChart;

// import {default as React, useEffect, useRef} from "react";
// import * as d3 from "d3";
// import {adjustedDimensions, Margin} from "./margins";
// import {Datum, PixelDatum, Series} from "./datumSeries";
// import {TimeRange, TimeRangeType} from "./timeRange";
// import {Selection, Axis, Line} from "d3";
//
// const defaultMargin = {top: 30, right: 20, bottom: 30, left: 50};
// const defaultAxesStyle = {color: '#d2933f'};
// const defaultAxesLabelFont = {
//     size: 12,
//     color: '#d2933f',
//     weight: 300,
//     family: 'sans-serif'
// };
// const defaultSpikesStyle = {
//     color: '#c95d15',
//     lineWidth: 2,
//     highlightColor: '#d2933f',
//     highlightWidth: 4
// };
// const defaultPlotGridLines = {visible: true, color: 'rgba(210,147,63,0.35)'};
//
//
// interface Axes {
//     xAxis: Axis<number | {valueOf(): number}>;
//     yAxis: Axis<number | {valueOf(): number}>;
//     xAxisSelection: AxisElementSelection;
//     yAxisSelection: AxisElementSelection;
// }
//
// // the axis-element type return when calling the ".call(axis)" function
// type AxisElementSelection = Selection<SVGGElement, unknown, null, undefined>;
//
// interface Props {
//     width: number;
//     height: number;
//     margin?: Partial<Margin>;
//     axisLabelFont?: Partial<{ size: number, color: string, family: string, weight: number }>;
//     axisStyle?: Partial<{ color: string }>;
//     backgroundColor?: string;
//     spikesStyle?: Partial<{color: string, lineWidth: number, highlightColor: string, highlightWidth: number}>;
//     plotGridLines?: Partial<{ visible: boolean, color: string }>;
//
//     minWeight?: number;
//     maxWeight?: number;
//
//     // data to plot: min-time is the earliest time for which to plot the data; max-time is the latest
//     // and series list is a list of time-series to plot
//     minTime: number;
//     maxTime: number;
//     seriesList: Array<Series>;
// }
//
// /**
//  *
//  * @param {Props} props
//  * @return {JSX.Element}
//  * @constructor
//  */
// function ScatterChart(props: Props): JSX.Element {
//
//     const {
//         width,
//         height,
//         backgroundColor = '#202020',
//         minWeight = -1, maxWeight = 1,
//         minTime, maxTime,
//         seriesList
//     } = props;
//
//     // override the defaults with the parent's properties, leaving any unset values as the default value
//     const margin = {...defaultMargin, ...props.margin};
//     const axisStyle = {...defaultAxesStyle, ...props.axisStyle};
//     const axisLabelFont = {...defaultAxesLabelFont, ...props.axisLabelFont};
//     const plotGridLines = {...defaultPlotGridLines, ...props.plotGridLines};
//     const spikesStyle = {...defaultSpikesStyle, ...props.spikesStyle};
//
//     // grab the dimensions of the actual plot after removing the margins from the specified width and height
//     const plotDimensions = adjustedDimensions(width, height, margin);
//
//     // the container that holds the d3 svg element
//     const containerRef = useRef<SVGSVGElement>(null);
//     const mainGRef = useRef<Selection<SVGGElement, any, null, undefined>>();
//     const spikesRef = useRef<Selection<SVGGElement, Series, SVGGElement, any>>();
//     const magnifierRef = useRef<Selection<SVGRectElement, Datum, null, undefined>>();
//     const trackerRef = useRef<Selection<SVGLineElement, Datum, null, undefined>>();
//
//     const mouseCoordsRef = useRef<number>(0);
//     const zoomFactorRef = useRef<number>(1);
//
//     // reference to the axes for the plot
//     const axesRef = useRef<Axes>();
//
//     // // unlike the magnifier, the handler forms a closure on the tooltip properties, and so if they change in this
//     // // component, the closed properties are unchanged. using a ref allows the properties to which the reference
//     // // points to change.
//     // const tooltipRef = useRef(tooltip);
//
//     // calculates to the time-range based on the (min, max)-time from the props
//     const timeRangeRef = useRef<TimeRangeType>(TimeRange(minTime, maxTime));
//
//     // const maxTime = calcMaxTime(seriesList);
//     const xScale = d3.scaleLinear()
//         // .domain([timeRangeRef.current.start, timeRangeRef.current.end])
//         .domain([timeRangeRef.current.start, timeRangeRef.current.end])
//         .range([0, plotDimensions.width]);
//
//     const yScale = d3.scaleLinear()
//         .domain([minWeight, maxWeight])
//         .range([plotDimensions.height, 0]);
//
//     const line = d3.line()
//         // .defined(d => !isNaN(d.y))
//         .x(d => xScale(d[0]))// + timeRangeRef.current.start))
//         .y(d => yScale(d[1]))
//
//
//     /**
//      * Updates the plot data for the specified time-range, which may have changed due to zoom or pan
//      * @param {TimeRange} timeRange The current time range
//      */
//     function updatePlot(timeRange: TimeRangeType) {
//         // tooltipRef.current = tooltip;
//         timeRangeRef.current = timeRange;
//
//         if (containerRef.current) {
//             // select the text elements and bind the data to them
//             const svg = d3
//                 .select<SVGSVGElement, any>(containerRef.current)
//             ;
//
//             // // set up the magnifier once
//             // if(magnifier.visible && magnifierRef.current === undefined) {
//             //     const linearGradient = svg
//             //         .append<SVGDefsElement>('defs')
//             //         .append<SVGLinearGradientElement>('linearGradient')
//             //         .attr('id', 'magnifier-gradient')
//             //         .attr('x1', '0%')
//             //         .attr('x2', '100%')
//             //         .attr('y1', '0%')
//             //         .attr('y2', '0%')
//             //     ;
//             //
//             //     const borderColor = d3.rgb(tooltip.backgroundColor).brighter(3.5).hex();
//             //     linearGradient
//             //         .append<SVGStopElement>('stop')
//             //         .attr('offset', '0%')
//             //         .attr('stop-color', borderColor)
//             //     ;
//             //
//             //     linearGradient
//             //         .append<SVGStopElement>('stop')
//             //         .attr('offset', '30%')
//             //         .attr('stop-color', tooltip.backgroundColor)
//             //         .attr('stop-opacity', 0)
//             //     ;
//             //
//             //     linearGradient
//             //         .append<SVGStopElement>('stop')
//             //         .attr('offset', '70%')
//             //         .attr('stop-color', tooltip.backgroundColor)
//             //         .attr('stop-opacity', 0)
//             //     ;
//             //
//             //     linearGradient
//             //         .append<SVGStopElement>('stop')
//             //         .attr('offset', '100%')
//             //         .attr('stop-color', borderColor)
//             //     ;
//             //
//             //     magnifierRef.current = svg
//             //         .append<SVGRectElement>('rect')
//             //         .attr('class', 'magnifier')
//             //         .attr('y', margin.top)
//             //         .attr('height', plotDimensions.height - margin.top)
//             //         .attr('stroke', tooltip.borderColor)
//             //         .attr('stroke-width', tooltip.borderWidth)
//             //         .style('fill', 'url(#magnifier-gradient')
//             //     ;
//             //
//             //     svg.on('mousemove', () => handleShowMagnify(magnifierRef.current));
//             // }
//             // // if the magnifier was defined, and is now no longer defined (i.e. props changed, then remove the magnifier)
//             // else if(!magnifier.visible && magnifierRef.current) {
//             //     magnifierRef.current = undefined;
//             // }
//             //
//             // // set up the tracker-line once
//             // if(tracker.visible && trackerRef.current === undefined) {
//             //     trackerRef.current = svg
//             //         .append<SVGLineElement>('line')
//             //         .attr('class', 'tracker')
//             //         .attr('y1', margin.top)
//             //         .attr('y2', plotDimensions.height)
//             //         .attr('stroke', tooltip.borderColor)
//             //         .attr('stroke-width', tooltip.borderWidth)
//             //         .attr('opacity', 0) as Selection<SVGLineElement, Datum, null, undefined>
//             //     ;
//             //
//             //     svg.on('mousemove', () => handleShowTracker(trackerRef.current));
//             // }
//             // // if the magnifier was defined, and is now no longer defined (i.e. props changed, then remove the magnifier)
//             // else if(!tracker.visible && trackerRef.current) {
//             //     trackerRef.current = undefined;
//             // }
//
//             // set up the main <g> container for svg and translate it based on the margins, but do it only
//             // once
//             if(mainGRef.current === undefined) {
//                 mainGRef.current = svg
//                     .attr('width', width)
//                     .attr('height', height)
//                     .attr('color', axisStyle.color)
//                     .append<SVGGElement>('g')
//                 ;
//             }
//             else {
//                 spikesRef.current = mainGRef.current!
//                     .selectAll<SVGGElement, Series>('g')
//                     .data<Series>(seriesList)
//                     .enter()
//                     .append('g')
//                     .attr('class', 'spikes-series')
//                     .attr('id', series => series.name)
//                     .attr('transform', `translate(${margin.left}, ${margin.top})`);
//             }
//
//             // // set up panning
//             // const drag = d3.drag<SVGSVGElement, Datum>()
//             //     .on("start", () => d3.select(containerRef.current).style("cursor", "move"))
//             //     .on("drag", () => onPan(d3.event.dx))
//             //     .on("end", () => d3.select(containerRef.current).style("cursor", "auto"))
//             // ;
//             //
//             // svg.call(drag);
//             //
//             // // set up for zooming
//             // const zoom = d3.zoom<SVGSVGElement, Datum>()
//             //     .scaleExtent([0, 10])
//             //     .translateExtent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]])
//             //     .on("zoom", () => {
//             //         console.log(d3.event);
//             //         onZoom(d3.event.transform, d3.event.sourceEvent.offsetX -  margin.left);
//             //     })
//             // ;
//             //
//             // svg.call(zoom);
//
//             // calculate the mapping between the times in the data (domain) and the display
//             // location on the screen (range)
//             // const maxTime = calcMaxTime(seriesList);
//                 // .domain([timeRangeRef.current.start, timeRangeRef.current.end])
//             //     xScale.domain([timeRangeRef.current.start, timeRangeRef.current.end])
//             //     .range([0, plotDimensions.width]);
//             //
//             // yScale
//             //     .domain([minWeight, maxWeight])
//             //     .range([plotDimensions.height, 0]);
//             // const xScale = d3.scaleLinear()
//             //     // .domain([timeRangeRef.current.start, timeRangeRef.current.end])
//             //     .domain([timeRangeRef.current.start, timeRangeRef.current.end])
//             //     .range([0, plotDimensions.width]);
//             //
//             // const yScale = d3.scaleLinear()
//             //     .domain([minWeight, maxWeight])
//             //     .range([plotDimensions.height, 0]);
//
//             // create and add the axes, grid-lines, and mouse-over functions
//             if (!axesRef.current) {
//                 const xAxis = d3.axisBottom(xScale);
//                 const yAxis = d3.axisLeft(yScale);
//                 const xAxisSelection = svg
//                     .append<SVGGElement>('g')
//                     .attr('class', 'x-axis')
//                     .attr('transform', `translate(${margin.left}, ${plotDimensions.height})`)
//                     .call(xAxis);
//
//                 const yAxisSelection = svg
//                     .append<SVGGElement>('g')
//                     .attr('class', 'y-axis')
//                     .attr('transform', `translate(${margin.left}, ${margin.top})`)
//                     .call(yAxis);
//
//                 axesRef.current = {
//                     xAxis: xAxis,
//                     yAxis: yAxis,
//                     xAxisSelection: xAxisSelection,
//                     yAxisSelection: yAxisSelection
//                 };
//
//                 svg
//                     .append<SVGTextElement>('text')
//                     .attr('text-anchor', 'middle')
//                     .attr('font-size', axisLabelFont.size)
//                     .attr('fill', axisLabelFont.color)
//                     .attr('font-family', axisLabelFont.family)
//                     .attr('font-weight', axisLabelFont.weight)
//                     .attr('transform', `translate(${margin.left + plotDimensions.width / 2}, ${plotDimensions.height + margin.top + (margin.bottom / 3)})`)
//                     .text("t (ms)");
//
//                 // if (plotGridLines.visible) {
//                 //     const gridLines = svg
//                 //         .select<SVGGElement>('g')
//                 //         .selectAll('grid-line')
//                 //         .data(seriesList.map(series => series.name));
//                 //
//                 //     gridLines
//                 //         .enter()
//                 //         .append<SVGLineElement>('line')
//                 //         .attr('x1', margin.left)
//                 //         .attr('x2', margin.left + plotDimensions.width)
//                 //         .attr('y1', d => (yScale(d) || 0) + margin.top + lineHeight / 2)
//                 //         .attr('y2', d => (yScale(d) || 0) + margin.top + lineHeight / 2)
//                 //         .attr('stroke', plotGridLines.color)
//                 //     ;
//                 // }
//
//             }
//             // update the scales
//             else {
//                 axesRef.current.xAxis = d3.axisBottom(xScale);
//                 axesRef.current.xAxisSelection.call(axesRef.current.xAxis);
//                 axesRef.current.yAxis = d3.axisLeft(yScale);
//                 axesRef.current.yAxisSelection.call(axesRef.current.yAxis);
//             }
//
//             seriesList.forEach(series => {
//                 // const line: Line<[number, number]> = d3.line()
//                 //     .x(datum => xScale(datum[0]))
//                 //     .y(datum => yScale(datum[1]))
//                 // ;
//
//                 // svg.append("path")
//                 //     .data(series.data)
//                 //     .attr("class", "line")
//                 //     .attr("d", line)
//                 // ;
//
//                 const container = svg
//                     .select<SVGGElement>(`#${series.name}`)
//                     // .append('path')
//                     .datum(series.data
//                         .filter(datum => datum.time >= timeRangeRef.current.start && datum.time <= timeRangeRef.current.end)
//                         .map(datum => [datum.time, datum.value]) as Array<[number, number]>
//                     )
//                         .append("path")
//                     // .attr("fill", "none")
//                     // .attr("stroke", "steelblue")
//                     // .attr("d", d3.line()
//                     //     // .defined(d => !isNaN(d.y))
//                     //     .x(d => xScale(d[0]))
//                     //     .y(d => yScale(d[1]))
//                     // )
//                 ;
//
//                 // enter new elements
//                 // const y = (yScale(series.name) || 0);
//                 container
//                     // .enter()
//                     // .append<SVGPathElement>('path')
//                     // .attr("transform", `translate(${25}, 0)}`)
//                     // .filter(datum => datum.time >= timeRangeRef.current.start)
//                     // .each(datum => ({x: xScale(datum.time), y: yScale(datum.value), ...datum}))
//                     .attr("fill", "none")
//                     .attr("stroke", "steelblue")
//                     .attr("d", line)
//                     // even though the tooltip is may not be set to show up on the mouseover, we want to attach the handler
//                     // so that when the use enables tooltips the handlers will show the the tooltip
//                     // .on("mouseover", (datum, i, group) => handleShowTooltip(datum, series.name, group[i]))
//                     // .on("mouseleave", (datum, i, group) => handleHideTooltip(datum, series.name, group[i]))
//                 ;
//
//                 // update existing elements
//                 // container
//                 //     // .filter(datum => datum[0] >= timeRangeRef.current.start)
//                 //     // .each(datum => ({x: xScale(datum.time), y: yScale(datum.value), ...datum}))
//                 //     // .attr('x', datum => datum.x)
//                 //     // .attr('y', datum => datum.y)
//                 //     .attr("fill", "none")
//                 //     .attr("stroke", "steelblue")
//                 //     .attr("d", line)
//                 //
//                 // ;
//                 //
//                 // // exit old elements
//                 // container.exit().remove()
//                 // ;
//             });
//         }
//     }
//
//     // called when:
//     // 1. component mounts to set up the main <g> element and a <g> element for each series
//     //    into which d3 renders the series
//     // 2. series data changes
//     // 3. time-window changes
//     // 4. plot attributes change
//     useEffect(
//         () => {
//             const timeRange = timeRangeRef.current.matchesOriginal(minTime, maxTime) ? timeRangeRef.current : TimeRange(minTime, maxTime);
//             updatePlot(timeRange);
//         }
//     );
//
//     return (
//         <svg
//             className="streaming-scatter-chart-d3"
//             width={width}
//             height={height * seriesList.length}
//             style={{backgroundColor: backgroundColor}}
//             ref={containerRef}
//         />
//     );
// }
//
// export default ScatterChart;