'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { cn, slugify } from '@/lib/utils';

import type { FaqEntry } from './json-ld';

/**
 * FAQ list. Single-open accordion so the page does not grow unpredictably
 * while reading, and `collapsible` so the last open item can be closed.
 */
export function FaqAccordion({
  entries,
  className,
  idPrefix = 'faq',
}: {
  entries: readonly FaqEntry[];
  className?: string;
  idPrefix?: string;
}) {
  return (
    <Accordion type="single" collapsible className={cn('w-full', className)}>
      {entries.map((entry) => (
        <AccordionItem key={entry.question} value={`${idPrefix}-${slugify(entry.question)}`}>
          <AccordionTrigger className="text-[14px]">{entry.question}</AccordionTrigger>
          <AccordionContent>
            <p className="max-w-3xl text-[13.5px] leading-relaxed text-muted">{entry.answer}</p>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
