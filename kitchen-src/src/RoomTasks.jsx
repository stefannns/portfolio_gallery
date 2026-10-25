import React from 'react';
import './room-tasks.css';

export default function RoomTasks({vegetablesViewed = false, recorderViewed = false, computerViewed = false}) {
  const tasks = [
    {id: 'vegetables', label: 'Look at the vegetables bag', complete: !!vegetablesViewed},
    {id: 'recorder', label: 'Look at the recorder', complete: !!recorderViewed},
    {id: 'computer', label: 'Explore the computer', complete: !!computerViewed},
  ];
  const completed = tasks.filter(task => task.complete).length;
  const current = tasks.findIndex(task => !task.complete);
  const progress = `${completed} of ${tasks.length} tasks complete.`;
  const next = current < 0 ? 'Kitchen tour complete. Have a look around.' : `Next: ${tasks[current].label}.`;

  return <aside className="room-tasks" aria-label="Tasks">
    <header className="room-tasks__header">
      <h2>{current < 0 ? 'All done!' : 'To do'}</h2>
      <span className="room-tasks__progress" role="status" aria-live="polite" aria-atomic="true">
        <span aria-hidden="true">{completed}/{tasks.length}</span>
        <span className="room-tasks__sr">{progress} {next}</span>
      </span>
    </header>
    <ol className="room-tasks__list" aria-label="Kitchen tour tasks">
      {tasks.map((task, index) => <li
        className={`room-tasks__task${task.complete ? ' room-tasks__task--complete' : ''}${index === current ? ' room-tasks__task--current' : ''}`}
        key={task.id}
        data-objective={task.id}
        aria-current={index === current ? 'step' : undefined}
      >
        <span className="room-tasks__mark" aria-hidden="true">{task.complete && <svg viewBox="0 0 24 24"><path d="m4 12 5 6L21 4"/></svg>}</span>
        <span className="room-tasks__label">{task.label}{task.complete && <span className="room-tasks__sr">, complete</span>}</span>
      </li>)}
    </ol>
    {completed === tasks.length && <p className="room-tasks__ready">Have a look around.</p>}
  </aside>;
}
