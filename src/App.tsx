import React, { useState, useCallback } from 'react';
import { View, Job, Sub, Service } from './types';
import { RoleSelect } from './components/RoleSelect';
import { OwnerLogin } from './components/OwnerLogin';
import { SubLogin } from './components/SubLogin';
import { Dashboard } from './components/Dashboard';
import { JobDetail } from './components/JobDetail';
import { JobForm } from './components/JobForm';
import { SubOverview } from './components/SubOverview';
import { SubDashboard } from './components/SubDashboard';
import { PipelineList } from './components/PipelineList';
import { PipelineForm } from './components/PipelineForm';
import { PipelineDetail } from './components/PipelineDetail';
import { db } from './db'

const App: React.FC = () => {
  const [view, setView] = useState<View>('role-select');
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [selectedPipelineId, setSelectedPipelineId] = useState<number | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [allServices, setAllServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(false);

  // Sub portal state
  const [loggedInSubId, setLoggedInSubId] = useState<number | null>(null);
  const [loggedInSubName, setLoggedInSubName] = useState<string>('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [jobRows, subRows, svcRows] = await Promise.all([
        db.query('SELECT j.*, j.metro, s.name as sub_name FROM jobs j LEFT JOIN subs s ON j.sub_id = s.id ORDER BY j.property_name ASC'),
        db.query('SELECT * FROM subs ORDER BY name ASC'),
        db.query('SELECT * FROM services ORDER BY deadline ASC'),
      ]);
      setJobs(jobRows as unknown as Job[]);
      setSubs(subRows as unknown as Sub[]);
      setAllServices(svcRows as unknown as Service[]);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleOwnerLogin() {
    loadData().then(() => setView('dashboard'));
  }

  function handleSubLogin(subId: number, subName: string) {
    setLoggedInSubId(subId);
    setLoggedInSubName(subName);
    loadData().then(() => setView('sub-portal'));
  }

  function handleLogout() {
    setLoggedInSubId(null);
    setLoggedInSubName('');
    setView('role-select');
  }

  function handleSelectJob(id: number) {
    setSelectedJobId(id);
    setView('job-detail');
  }

  function handleAddJob() {
    setSelectedJobId(null);
    setView('add-job');
  }

  function handleEditJob(id: number) {
    setSelectedJobId(id);
    setView('edit-job');
  }

  async function handleDeleteJob(id: number) {
    try {
      await db.execute(`DELETE FROM services WHERE job_id = ${id}`);
      await db.execute(`DELETE FROM jobs WHERE id = ${id}`);
      setJobs(prev => prev.filter(j => j.id !== id));
      setView('dashboard');
    } catch (err) {
      console.error('Failed to delete job:', err);
    }
  }

  function handleSaved() {
    loadData();
    setView('dashboard');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  switch (view) {
    case 'role-select':
      return (
        <RoleSelect
          onOwner={() => setView('owner-login')}
          onContractor={() => setView('sub-login')}
        />
      );
    case 'owner-login':
      return (
        <OwnerLogin
          onSuccess={handleOwnerLogin}
          onBack={() => setView('role-select')}
        />
      );
    case 'sub-login':
      return (
        <SubLogin
          onSuccess={handleSubLogin}
          onBack={() => setView('role-select')}
        />
      );
    case 'sub-portal':
      return (
        <SubDashboard
          subs={subs}
          jobs={jobs}
          allServices={allServices}
          onBack={handleLogout}
          isPortalMode={true}
          loggedInSubName={loggedInSubName}
        />
      );
    case 'dashboard':
      return (
        <Dashboard
          jobs={jobs}
          allServices={allServices}
          onSelectJob={handleSelectJob}
          onAddJob={handleAddJob}
          onSubOverview={() => setView('sub-overview')}
          onPipeline={() => setView('pipeline')}
          onSubDashboard={() => setView('sub-dashboard')}
          onLogout={handleLogout}
        />
      );
    case 'job-detail':
      return (
        <JobDetail
          jobId={selectedJobId!}
          onBack={() => { setView('dashboard'); loadData(); }}
          onEdit={handleEditJob}
          onDelete={handleDeleteJob}
        />
      );
    case 'add-job':
      return (
        <JobForm
          editJobId={null}
          subs={subs}
          onSave={handleSaved}
          onCancel={() => setView('dashboard')}
        />
      );
    case 'edit-job':
      return (
        <JobForm
          editJobId={selectedJobId}
          subs={subs}
          onSave={handleSaved}
          onCancel={() => { setView('job-detail'); }}
        />
      );
    case 'sub-dashboard':
      return (
        <SubDashboard
          subs={subs}
          jobs={jobs}
          allServices={allServices}
          onBack={() => { setView('dashboard'); loadData(); }}
        />
      );
    case 'sub-overview':
      return (
        <SubOverview
          subs={subs}
          jobs={jobs}
          allServices={allServices}
          onBack={() => { setView('dashboard'); loadData(); }}
          onSelectJob={handleSelectJob}
        />
      );
    case 'pipeline':
      return (
        <PipelineList
          onBack={() => setView('dashboard')}
          onSelect={(id) => { setSelectedPipelineId(id); setView('pipeline-detail'); }}
          onNew={() => { setSelectedPipelineId(null); setView('pipeline-new'); }}
        />
      );
    case 'pipeline-detail':
      return (
        <PipelineDetail
          jobId={selectedPipelineId!}
          onBack={() => setView('pipeline')}
          onEdit={(id) => { setSelectedPipelineId(id); setView('pipeline-edit'); }}
        />
      );
    case 'pipeline-new':
      return (
        <PipelineForm
          editId={null}
          onSave={() => setView('pipeline')}
          onCancel={() => setView('pipeline')}
        />
      );
    case 'pipeline-edit':
      return (
        <PipelineForm
          editId={selectedPipelineId}
          onSave={() => { setSelectedPipelineId(selectedPipelineId); setView('pipeline-detail'); }}
          onCancel={() => setView('pipeline-detail')}
        />
      );
    default:
      return null;
  }
};

export default App;
