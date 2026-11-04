'use client';

import { FC, useEffect, useMemo, useRef } from 'react';
import DrawChart from 'chart.js/auto';
import { TotalList } from '@gitroom/frontend/components/analytics/stars.and.forks.interface';
import { chunk } from 'lodash';
import useCookie from 'react-use-cookie';

function mergeDataPoints(data: TotalList[], numPoints: number): TotalList[] {
  const res = chunk(data, Math.ceil(data.length / numPoints));
  return res.map((row) => {
    return {
      date: `${row[0].date} - ${row?.at(-1)?.date}`,
      total: row.reduce((acc, curr) => acc + curr.total, 0),
    };
  });
}

export const ChartSocial: FC<{
  data: TotalList[];
  color?: 'purple' | 'green' | 'blue';
}> = (props) => {
  const { data, color = 'purple' } = props;
  const [mode] = useCookie('mode', 'dark');

  const list = useMemo(() => {
    const merged = data.length < 7 ? data : mergeDataPoints(data, 7);
    if (merged.length === 1) {
      return [
        // duplicating single datapoints metrics for chart to display a line on analytics
        merged[0],
        merged[0],
      ];
    }
    return merged;
  }, [data]);

  const ref = useRef<any>(null);
  const chart = useRef<null | DrawChart>(null);

  const colorSchemes = {
    purple: {
      start: 'rgba(97, 43, 211, 0.8)',
      end: 'rgba(97, 43, 211, 0.1)',
      border: 'rgb(97, 43, 211)',
    },
    green: {
      start: 'rgba(50, 213, 131, 0.8)',
      end: 'rgba(50, 213, 131, 0.1)',
      border: 'rgb(50, 213, 131)',
    },
    blue: {
      start: 'rgba(29, 155, 240, 0.8)',
      end: 'rgba(29, 155, 240, 0.1)',
      border: 'rgb(29, 155, 240)',
    },
  };

  const colors = colorSchemes[color];

  useEffect(() => {
    const glass = document.documentElement.dataset.linkselfTheme === 'glass-frame';
    const tokens = getComputedStyle(document.body);
    const studioColor = (name: string) => tokens.getPropertyValue(`--studio-${name}`).trim();
    const chartColors = glass ? { start: studioColor('chart'), end: studioColor('panel'), border: studioColor(color === 'green' ? 'success' : color === 'blue' ? 'text' : 'accent') } : colors;
    const ctx = ref.current.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, ref.current.height);
    gradient.addColorStop(0, chartColors.start);
    gradient.addColorStop(1, chartColors.end);

    chart.current = new DrawChart(ref.current!, {
      type: glass ? 'bar' : 'line',
      options: {
        maintainAspectRatio: false,
        responsive: true,
        animation: {
          duration: glass ? 0 : 750,
          easing: 'easeOutQuart',
        },
        interaction: {
          mode: 'index',
          intersect: false,
        },
        layout: {
          padding: {
            left: 0,
            right: 0,
            top: 4,
            bottom: 0,
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            display: false,
          },
          x: {
            display: false,
            ticks: {
              stepSize: 10,
              maxTicksLimit: 7,
            },
          },
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            enabled: true,
            backgroundColor: glass ? studioColor('panel') : mode === 'dark' ? '#1e1d1d' : '#fff',
            titleColor: glass ? studioColor('text') : mode === 'dark' ? '#fff' : '#000',
            bodyColor: glass ? studioColor('muted') : mode === 'dark' ? '#9c9c9c' : '#777',
            borderColor: glass ? studioColor('line') : mode === 'dark' ? '#2b2b2b' : '#e7e9eb',
            borderWidth: 1,
            padding: 10,
            cornerRadius: glass ? 14 : 8,
            displayColors: false,
            titleFont: {
              ...(glass && { family: getComputedStyle(document.body).fontFamily }),
              size: glass ? 14 : 12,
              weight: 'normal',
            },
            bodyFont: {
              ...(glass && { family: getComputedStyle(document.body).fontFamily }),
              size: 14,
              weight: 'bold',
            },
          },
        },
      },
      data: {
        labels: list.map((row) => row.date),
        datasets: [
          {
            borderColor: chartColors.border,
            borderWidth: 2,
            label: 'Total',
            backgroundColor: glass ? list.map((_, index) => studioColor(index === list.length - 1 ? 'accent' : 'chart')) : gradient,
            ...(glass && { borderRadius: 14, borderWidth: 0 }),
            fill: true,
            data: list.map((row) => row.total),
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: chartColors.border,
            pointHoverBorderColor: glass ? studioColor('panel') : mode === 'dark' ? '#1e1d1d' : '#fff',
            pointHoverBorderWidth: 2,
          },
        ],
      },
    });
    return () => {
      chart?.current?.destroy();
    };
  }, [color, data, mode]);

  return <canvas className="w-full h-full" ref={ref} />;
};
