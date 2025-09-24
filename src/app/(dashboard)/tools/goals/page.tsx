import GoalsView from './_components/goals-view';

export default function GoalsPage() {
	return (
		<div className='space-y-4'>
			<h1 className='text-2xl font-semibold tracking-tight'>Goals</h1>
			<GoalsView />
		</div>
	);
}
