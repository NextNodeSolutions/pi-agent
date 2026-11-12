# shell.zsh sources this file in a Herdr terminal where a human types commands.
{ zmodload zsh/zselect zsh/datetime zsh/system && zmodload -F zsh/files b:zf_mkdir b:zf_rm } 2>/dev/null || return 0
typeset -g _tailnet_link_command=${${(%):-%x}:A:h}/tailnet-link _tailnet_link_start_centiseconds=100
# The watcher counts each URL over the same span at every reading, wider than the history a Herdr terminal keeps.
typeset -g _tailnet_link_history_lines=10000
# hc read has no time limit, and its server may take the call and never answer.
typeset -g _tailnet_link_read_seconds=10
typeset -g _tailnet_link_record=$HOME/.local/state/tailnet-link/commands/$$
zf_mkdir -p ${_tailnet_link_record:h} 2>/dev/null || return 0
# A shell that ended through exec or a kill ran no exit hook, so the next terminal removes the record it left.
# kill takes a name such as %1 for a job and wakes that job, so only a name that is a process number is probed.
for _tailnet_link_left in ${_tailnet_link_record:h}/<->(N); do
	kill -0 ${_tailnet_link_left:t} 2>/dev/null || zf_rm -f $_tailnet_link_left 2>/dev/null
done
unset _tailnet_link_left

# A reading that stays silent past the limit is ended while its pipe is still open, which shows that hc still runs.
_tailnet_link_read() {
	emulate -L zsh
	# zsh lowers the priority of a job started beside it, and a late reading takes the command's first output for older text.
	setopt no_bg_nice
	local input reader ended=0 end_of_reading=5
	coproc hc read $HC_TERMINAL_ID --lines $_tailnet_link_history_lines
	reader=$!
	exec {input}<&p
	# sysread returns 0 for each part it copies, then its code for the end of the reading or the one of a failure.
	until (( ended )); do
		sysread -i $input -o 1 -t $_tailnet_link_read_seconds
		ended=$?
	done
	(( ended == end_of_reading )) || kill $reader
	# hc may answer and end between the limit and the kill, so its own success does not make the reading whole.
	wait $reader && (( ended == end_of_reading ))
}

# The shell tells its watcher that the command ended by rewriting a file, and never by a signal: the watcher may have
# ended long before, and its process number may be another program's by then.
_tailnet_link_announce() {
	emulate -L zsh
	local serial=$EPOCHREALTIME
	{ print -r -- $serial >| $_tailnet_link_record } 2>/dev/null || return 0
	# A process substitution starts the watcher and leaves $! to the background jobs the human starts.
	: <(
		# Without job control the watcher shares the shell's process group, where the interrupt and suspend keys reach it.
		trap '' INT QUIT TSTP
		local shown
		{
			# Without this reading every URL of the terminal would look new, so a read that fails starts no watcher.
			shown="$(_tailnet_link_read)" && {
				# The wait happens here, so a command that ends at once starts no watcher.
				zselect -t $_tailnet_link_start_centiseconds
				[[ $(<$_tailnet_link_record) == $serial ]]
			}
		} 2>/dev/null && exec $_tailnet_link_command announce $$ $_tailnet_link_record $serial $_tailnet_link_history_lines \
			>/dev/null <<< $shown
	)
}

_tailnet_link_silence() {
	emulate -L zsh
	{ : >| $_tailnet_link_record } 2>/dev/null
}

# zsh also runs its exit hooks in a subshell that calls exit, and the record belongs to the shell that stays.
_tailnet_link_forget() {
	emulate -L zsh
	(( ZSH_SUBSHELL )) || zf_rm -f $_tailnet_link_record 2>/dev/null
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec _tailnet_link_announce
add-zsh-hook precmd _tailnet_link_silence
add-zsh-hook zshexit _tailnet_link_forget
