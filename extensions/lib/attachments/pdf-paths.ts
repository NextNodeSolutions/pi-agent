/** PDF side of prompt file captures: alias format, sniffing, size bounds. */

import { closeSync, openSync, readSync, statSync } from 'node:fs'

import { looksLikePath, resolvePath } from './image-paths.ts'

/** Alias format inserted into prompt text in place of a PDF path. */
export const PDF_ALIAS_PATTERN = /\[pdf:\d+\]/gu

export function toPdfAlias(number: number): string {
	return `[pdf:${number}]`
}

/** The agent reads a PDF at its path; never a payload copy in memory. */
export type PdfPromptCapture = {
	readonly type: 'pdf'
	readonly alias: string
	readonly filePath: string
	readonly byteSize: number
}

/** +256 MiB per document; beyond this the capture refuses the file. */
const MAX_PDF_BYTES = 268_435_456

/** The magic every legit PDF starts with. */
const PDF_MAGIC = '%PDF-'
const MAGIC_LENGTH = PDF_MAGIC.length

/** Reads a PDF file's identity into a capture; undefined when it is no PDF. */
export function readPdfCapture(
	pathText: string,
	cwd: string,
	aliasNumber: number,
): PdfPromptCapture | undefined {
	if (!looksLikePath(pathText)) return undefined
	const filePath = resolvePath(pathText, cwd)
	try {
		const stats = statSync(filePath)
		if (!stats.isFile() || stats.size === 0 || stats.size > MAX_PDF_BYTES)
			return undefined
		if (!hasPdfMagic(filePath)) return undefined
		return {
			type: 'pdf',
			alias: toPdfAlias(aliasNumber),
			filePath,
			byteSize: stats.size,
		}
	} catch {
		return undefined
	}
}

/** Exact magic header check: 5 bytes read from the front, no full load. */
function hasPdfMagic(filePath: string): boolean {
	const fd = openSync(filePath, 'r')
	try {
		const magic = Buffer.alloc(MAGIC_LENGTH)
		const read = readSync(fd, magic, 0, MAGIC_LENGTH, 0)
		return (
			read >= MAGIC_LENGTH &&
			magic.toString('utf8', 0, read) === PDF_MAGIC
		)
	} finally {
		closeSync(fd)
	}
}

/** Bytes per unit step, and the floor under which one digit suffices. */
const BYTE_STEP = 1024
const ONE_DIGIT_FLOOR = 10

/** Compact size for the Documents line the agent reads: 56.3 KB, 1.2 MB. */
export function formatByteSize(bytes: number): string {
	const units = ['', ' KB', ' MB', ' GB', ' TB'] as const
	let size = bytes
	let step = 0
	while (size >= BYTE_STEP && step < units.length - 1) {
		size /= BYTE_STEP
		step += 1
	}
	const digits = size < ONE_DIGIT_FLOOR ? 1 : 0
	return `${size.toFixed(digits)}${units[step] ?? ''}`
}
